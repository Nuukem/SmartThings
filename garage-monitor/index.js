const { SmartThingsClient, BearerTokenAuthenticator } = require('@smartthings/core-sdk');
const cron = require('node-cron');
const axios = require('axios');
const Pushover = require('pushover-notifications');
require('dotenv').config();

// Configuration
const ST_API_TOKEN = process.env.SMARTTHINGS_TOKEN;

// Parse MONITORED_DEVICES - handle multiline JSON by removing whitespace
let MONITORED_DEVICES = [];
try {
  const devicesEnv = (process.env.MONITORED_DEVICES || '[]').replace(/\s+/g, ' ').trim();
  MONITORED_DEVICES = JSON.parse(devicesEnv);
} catch (error) {
  console.error('❌ Failed to parse MONITORED_DEVICES:', error.message);
  console.error('   Value:', process.env.MONITORED_DEVICES);
  process.exit(1);
}

const ROUTINE_ID = process.env.GO_TO_BED_ROUTINE_ID;

// Pushover configuration for Emergency priority notifications
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;

// Initialize Pushover client if credentials are provided
let pushover = null;
if (PUSHOVER_USER_KEY && PUSHOVER_API_TOKEN) {
  pushover = new Pushover({
    user: PUSHOVER_USER_KEY,
    token: PUSHOVER_API_TOKEN
  });
}

// Initialize SmartThings client
const client = new SmartThingsClient(
  new BearerTokenAuthenticator(ST_API_TOKEN),
  { urlTemplate: 'https://api.smartthings.com/v1' }
);

// Cache for device objects to reduce API calls
const deviceCache = new Map();

/**
 * Send notification via Pushover with Emergency priority
 * Pushes through silent phone and requires user acknowledgment
 */
async function sendPushoverNotification(message) {
  if (!pushover) {
    console.warn('⚠️  Pushover credentials not configured - skipping Pushover notification');
    return;
  }

  try {
    return new Promise((resolve, reject) => {
      pushover.send({
        title: '🚨 Door/Device Alert',
        message: message,
        priority: 2, // Emergency priority - pushes through silent
        retry: 60,   // Retry every 60 seconds
        expire: 300, // Expire after 5 minutes
        sound: 'incoming'
      }, function(err, result) {
        if (err) {
          console.error('❌ Failed to send Pushover notification:', err.message);
          reject(err);
        } else {
          console.log(`✅ Pushover notification sent (Emergency priority): "${message}"`);
          resolve(result);
        }
      });
    });
  } catch (error) {
    console.error('❌ Pushover notification error:', error.message);
  }
}

/**
 * Trigger virtual device to activate Alexa routine
 * Virtual devices act as a workaround to trigger routines via SmartThings
 */
async function triggerVirtualDevice(virtualDeviceId, deviceName) {
  if (!virtualDeviceId) {
    console.log(`ℹ️  No virtual device configured for ${deviceName} - skipping Alexa routine trigger`);
    return;
  }

  try {
    // Get the virtual device
    const device = await getDevice(virtualDeviceId);
    if (!device) {
      console.warn(`⚠️  Virtual device not found: ${virtualDeviceId}`);
      return;
    }

    // Toggle a virtual switch to trigger the associated Alexa routine
    // This works because Alexa routines can be triggered by switch state changes
    await client.devices.executeCommand(virtualDeviceId, {
      capability: 'switch',
      command: 'on'
    });

    console.log(`✅ Triggered virtual device for ${deviceName} (Alexa routine will execute)`);

    // Turn off after a short delay to reset the switch
    setTimeout(async () => {
      try {
        await client.devices.executeCommand(virtualDeviceId, {
          capability: 'switch',
          command: 'off'
        });
      } catch (error) {
        console.warn(`⚠️  Failed to reset virtual device: ${error.message}`);
      }
    }, 1000);

  } catch (error) {
    console.error(`❌ Failed to trigger virtual device for ${deviceName}:`, error.message);
  }
}

/**
 * Get device from cache or API
 */
async function getDevice(deviceId) {
  if (deviceCache.has(deviceId)) {
    return deviceCache.get(deviceId);
  }

  try {
    const device = await client.devices.get(deviceId);
    deviceCache.set(deviceId, device);
    return device;
  } catch (error) {
    console.error(`❌ Failed to get device ${deviceId}:`, error.message);
    return null;
  }
}

/**
 * Check if a device is open
 * Handles both door locks and contact sensors
 */
async function checkDeviceStatus(deviceId) {
  try {
    const device = await getDevice(deviceId);
    
    if (!device) {
      console.error(`❌ Device not found: ${deviceId}`);
      return null;
    }

    // Try to get door/contact status from capabilities
    const capabilities = device.components[0]?.capabilities || [];
    
    // DEBUG: Log all capabilities found on this device
    console.log(`🔍 DEBUG: Device ${deviceId} has ${capabilities.length} capability(ies):`);
    capabilities.forEach((cap, idx) => {
      console.log(`   [${idx}] Full capability object:`, JSON.stringify(cap, null, 2));
    });
    
    // Check for door lock capability
    const doorLockCap = capabilities.find(cap => cap.id === 'doorControl' || cap.id === 'lock');
    if (doorLockCap?.values?.door?.value) {
      console.log(`✅ DEBUG: Found doorControl/lock - value: ${doorLockCap.values.door.value}`);
      return doorLockCap.values.door.value;
    }

    // Check for contact sensor capability
    const contactCap = capabilities.find(cap => cap.id === 'contactSensor');
    if (contactCap) {
      console.log(`   Found contactSensor capability`);
      console.log(`   contactCap full object: ${JSON.stringify(contactCap, null, 2)}`);
      // Try different path structures
      const contactValue = contactCap.values?.contact?.value || contactCap.values?.contact;
      if (contactValue) {
        console.log(`✅ DEBUG: Found contactSensor - value: ${contactValue}`);
        return contactValue;
      } else {
        console.log(`   ⚠️  contactSensor found but no value at expected paths`);
      }
    }

    // Check for generic switch/sensor capability
    const switchCap = capabilities.find(cap => cap.id === 'switch');
    if (switchCap?.values?.switch?.value) {
      console.log(`✅ DEBUG: Found switch - value: ${switchCap.values.switch.value}`);
      return switchCap.values.switch.value;
    }

    console.warn(`⚠️  No recognized capability found for device ${deviceId}`);
    console.log(`💡 TIP: Check the debug output above to see what capabilities are available and report them`);
    return null;
  } catch (error) {
    console.error('❌ Failed to check device status:', error.message);
    return null;
  }
}

/**
 * Check all monitored devices or devices scheduled for a specific time
 * If checkAtTime provided, only check devices with matching checkTime
 * If checkAtTime not provided, check all devices (for manual/webhook triggers)
 * Returns array of open devices
 */
async function checkAllDevices(checkAtTime = null) {
  let devicesToCheck = MONITORED_DEVICES;
  
  if (checkAtTime !== null) {
    devicesToCheck = MONITORED_DEVICES.filter(device => {
      // If no checkTime specified, default is 21:00 (9pm)
      const deviceCheckTime = device.checkTime || '21:00';
      return deviceCheckTime === checkAtTime;
    });
    console.log(`🔍 Checking ${devicesToCheck.length} device(s) scheduled for ${checkAtTime}...`);
  } else {
    console.log(`🔍 Checking ${devicesToCheck.length} monitored device(s)...`);
  }
  
  const openDevices = [];
  
  for (const deviceConfig of devicesToCheck) {
    const status = await checkDeviceStatus(deviceConfig.id);
    
    if (status === 'open' || status === 'detected') {
      openDevices.push({
        name: deviceConfig.name,
        id: deviceConfig.id,
        status: status,
        checkTime: deviceConfig.checkTime || '21:00'
      });
      console.warn(`⚠️  ${deviceConfig.name} is OPEN`);
    } else if (status === 'closed' || status === 'clear') {
      console.log(`✅ ${deviceConfig.name} is closed`);
    } else if (status) {
      console.log(`ℹ️  ${deviceConfig.name} status: ${status}`);
    }
  }
  
  return openDevices;
}

/**
 * Handle device check - called at scheduled times or when routine executes
 * @param {string} checkAtTime - Optional time in HH:MM format to filter devices
 */
async function handleDeviceCheck(checkAtTime = null) {
  const openDevices = await checkAllDevices(checkAtTime);
  
  if (openDevices.length === 0) {
    console.log('✅ All monitored devices are closed - all good!');
    return;
  }

  // Build notification message
  let message;
  if (openDevices.length === 1) {
    message = `${openDevices[0].name} is still open`;
  } else {
    const deviceList = openDevices.map(d => d.name).join(', ');
    message = `${openDevices.length} devices still open: ${deviceList}`;
  }

  console.warn(`⚠️  ${message}`);

  // Send Pushover notification (Emergency priority - pushes through silent phone)
  await sendPushoverNotification(message);

  // Trigger virtual devices to activate Alexa routines
  for (const device of openDevices) {
    const deviceConfig = MONITORED_DEVICES.find(d => d.id === device.id);
    if (deviceConfig?.virtualDeviceId) {
      await triggerVirtualDevice(deviceConfig.virtualDeviceId, device.name);
    }
  }
}

/**
 * Schedule checks for all unique times across monitored devices
 * Each device can have its own checkTime (default: 21:00 / 9pm)
 */
function schedulePeriodicChecks() {
  // Get unique check times from all devices (default to 21:00 if not specified)
  const checkTimes = new Set(MONITORED_DEVICES.map(d => d.checkTime || '21:00'));
  
  const scheduledJobs = [];
  
  checkTimes.forEach(checkTime => {
    // Parse checkTime format HH:MM to cron format (MM HH * * *)
    const [hours, minutes] = checkTime.split(':');
    const cronExpression = `${minutes} ${hours} * * *`;
    
    const job = cron.schedule(cronExpression, () => {
      console.log(`⏰ Running scheduled check at ${checkTime}...`);
      handleDeviceCheck(checkTime);
    });

    scheduledJobs.push({ time: checkTime, job });
    console.log(`📅 Scheduled device check at ${checkTime} (cron: ${cronExpression})`);
  });

  return scheduledJobs;
}

/**
 * Express server for receiving webhooks from SmartThings
 */
function startWebhookServer() {
  const express = require('express');
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Webhook endpoint - called when routine executes
  app.post('/webhook/routine-triggered', async (req, res) => {
    const { routineId, routineName } = req.body;
    
    console.log(`🔔 Routine triggered: ${routineName} (${routineId})`);
    
    if (routineId === ROUTINE_ID || routineName?.includes('Go To Bed')) {
      console.log('🛏️  "Go To Bed" routine detected - checking ALL devices...');
      // When routine triggers, check ALL devices regardless of their scheduled checkTime
      await handleDeviceCheck(null);
    }

    res.json({ success: true });
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      uptime: process.uptime(),
      monitoredDevices: MONITORED_DEVICES.length
    });
  });

  // Endpoint to check devices on-demand
  app.all('/check', async (req, res) => {
    // Optional query parameter: ?time=HH:MM to check only devices scheduled for that time
    const checkTime = req.query.time || null;
    const openDevices = await checkAllDevices(checkTime);
    res.json({ 
      timestamp: new Date().toISOString(),
      checkTime: checkTime || 'all',
      monitoredCount: MONITORED_DEVICES.length,
      openDevices: openDevices
    });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Webhook server listening on port ${PORT}`);
    console.log(`   Health check: http://<your-nas-ip>:${PORT}/health`);
    console.log(`   Manual check: http://<your-nas-ip>:${PORT}/check (GET or POST)`);
    console.log(`   Routine trigger: POST http://<your-nas-ip>:${PORT}/webhook/routine-triggered`);
  });

  return app;
}

/**
 * Initialize the application
 */
async function initialize() {
  console.log('🚀 Starting Device Monitor...');
  console.log(`📱 Using SmartThings API Token: ${ST_API_TOKEN?.substring(0, 10)}...`);
  
  // Check Pushover configuration
  if (!PUSHOVER_USER_KEY || !PUSHOVER_API_TOKEN) {
    console.warn('⚠️  Pushover not configured - notifications will be limited');
  } else {
    console.log('✅ Pushover configured - Emergency priority notifications enabled');
  }

  console.log(`📊 Monitoring ${MONITORED_DEVICES.length} device(s):`);
  
  MONITORED_DEVICES.forEach((device, index) => {
    const checkTime = device.checkTime || '21:00';
    console.log(`   ${index + 1}. ${device.name} (${device.id}) - Check at ${checkTime}`);
    if (device.virtualDeviceId) {
      console.log(`      → Virtual device: ${device.virtualDeviceId} (triggers Alexa routine)`);
    }
  });

  if (MONITORED_DEVICES.length === 0) {
    console.error('❌ No devices configured! Please add devices to MONITORED_DEVICES in .env');
    process.exit(1);
  }

  try {
    // Verify API token works
    const devices = await client.devices.list();
    console.log(`✅ Connected to SmartThings - found ${devices.length} total device(s)`);

    // Verify all monitored devices exist
    for (const deviceConfig of MONITORED_DEVICES) {
      const device = await getDevice(deviceConfig.id);
      if (!device) {
        throw new Error(`Device not found: ${deviceConfig.name} (${deviceConfig.id})`);
      }
      console.log(`✅ ${deviceConfig.name} found`);

      // Verify virtual device if configured
      if (deviceConfig.virtualDeviceId) {
        const virtualDevice = await getDevice(deviceConfig.virtualDeviceId);
        if (!virtualDevice) {
          throw new Error(`Virtual device not found for ${deviceConfig.name} (${deviceConfig.virtualDeviceId})`);
        }
        console.log(`   ✅ Virtual device found (${virtualDevice.name})`);
      }
    }

    // Start services
    schedulePeriodicChecks();
    startWebhookServer();

    // Perform initial check
    console.log('\n📋 Performing initial device check...');
    await handleDeviceCheck();

  } catch (error) {
    console.error('❌ Initialization failed:', error.message);
    process.exit(1);
  }
}

// Start the app
initialize();
