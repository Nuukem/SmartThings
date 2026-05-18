const { SmartThingsClient, BearerTokenAuthenticator } = require('@smartthings/core-sdk');
const cron = require('node-cron');
const axios = require('axios');
const Pushover = require('pushover-notifications');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Configuration
const ST_API_TOKEN = process.env.SMARTTHINGS_TOKEN;
const DEBUG_LOGGING = process.env.DEBUG_LOGGING === 'true';

function debugLog(...args) {
  if (DEBUG_LOGGING) {
    console.log(...args);
  }
}

function isCompleteJson(value) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '[' || char === '{') {
      depth += 1;
    } else if (char === ']' || char === '}') {
      depth -= 1;
    }
  }

  return depth === 0 && !inString;
}

function readMultilineEnvJson(key) {
  const envPath = path.join(__dirname, '.env');

  if (!fs.existsSync(envPath)) {
    return null;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  const startPattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
  const startIndex = lines.findIndex(line => startPattern.test(line));

  if (startIndex === -1) {
    return null;
  }

  const firstValue = lines[startIndex].match(startPattern)[1];
  const jsonLines = [firstValue];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (isCompleteJson(jsonLines.join('\n'))) {
      break;
    }

    jsonLines.push(lines[index]);
  }

  return jsonLines.join('\n').trim();
}

// Accepts an explicit JSON string/object for tests or callers; otherwise reads MONITORED_DEVICES.
function parseMonitoredDevices(devicesJson) {
  if (devicesJson !== undefined) {
    if (typeof devicesJson === 'string') {
      return JSON.parse(devicesJson.trim() || '[]');
    }

    if (Array.isArray(devicesJson)) {
      return devicesJson;
    }

    if (devicesJson && typeof devicesJson === 'object') {
      return [devicesJson];
    }

    throw new TypeError('MONITORED_DEVICES must be a JSON string, array, or object');
  }

  const devicesEnv = (process.env.MONITORED_DEVICES || '[]').trim();

  try {
    return JSON.parse(devicesEnv);
  } catch (error) {
    const multilineDevicesEnv = readMultilineEnvJson('MONITORED_DEVICES');

    if (multilineDevicesEnv && multilineDevicesEnv !== devicesEnv) {
      return JSON.parse(multilineDevicesEnv);
    }

    throw error;
  }
}

// Parse MONITORED_DEVICES from dotenv, with support for unquoted multiline JSON in .env.
let MONITORED_DEVICES = [];
try {
  MONITORED_DEVICES = parseMonitoredDevices();
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
        priority: process.env.PUSHOVER_PRIORITY || 1, // 2 = Emergency, 1 = High, 0 = Normal, -1 = Low
        retry: 60,   // Retry every 60 seconds
        expire: 300, // Expire after 5 minutes
        sound: process.env.PUSHOVER_SOUND || null // Optional: specify a sound for emergency alerts
      }, function(err, result) {
        if (err) {
          console.error('❌ Failed to send Pushover notification:', err.message);
          reject(err);
        } else {
          debugLog(`✅ Pushover notification sent (Emergency priority): "${message}"`);
          resolve(result);
        }
      });
    });
  } catch (error) {
    console.error('❌ Pushover notification error:', error.message);
  }
}

async function turnOffVirtualDevice(virtualDeviceId, deviceName) {
  try {
    await client.devices.executeCommand(virtualDeviceId, {
      capability: 'switch',
      command: 'off'
    });
    debugLog(`✅ Reset virtual device for ${deviceName} (${virtualDeviceId}) to off`);
  } catch (error) {
    console.warn(`⚠️  Failed to reset virtual device for ${deviceName}: ${error.message}`);
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
 * Get a capability attribute value from supported SmartThings capability structures
 */
function getCapabilityAttributeValue(cap, attribute) {
  if (!cap) {
    return undefined;
  }

  if (cap.values) {
    const raw = cap.values[attribute];
    if (raw?.value !== undefined) {
      return raw.value;
    }
    return raw;
  }

  if (Array.isArray(cap.status)) {
    const statusEntry = cap.status.find(entry => entry.attribute === attribute);
    if (statusEntry?.value !== undefined) {
      return statusEntry.value;
    }
    if (cap.status[0]?.value !== undefined) {
      return cap.status[0].value;
    }
  }

  if (cap[attribute] !== undefined) {
    if (cap[attribute]?.value !== undefined) {
      return cap[attribute].value;
    }
    return cap[attribute];
  }

  if (cap.value !== undefined) {
    return cap.value;
  }

  return undefined;
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

    // Device capabilities describe what a device supports; status contains the live values.
    const capabilities = device.components[0]?.capabilities || [];
    const componentId = device.components[0]?.id || 'main';
    const deviceStatus = await client.devices.getStatus(deviceId);
    const componentStatus = deviceStatus.components?.[componentId] || deviceStatus.components?.main;
    
    if (!componentStatus) {
      console.warn(`⚠️  No status found for component "${componentId}" on device ${deviceId}`);
      debugLog(`🔍 SmartThings status payload for ${deviceId}: ${JSON.stringify(deviceStatus, null, 2)}`);
      return null;
    }

    debugLog(`🔍 SmartThings payload for ${deviceId}: ${JSON.stringify({
      componentId,
      declaredCapabilities: capabilities.map(cap => `${cap.id}@${cap.version || 'unknown'}`),
      statusCapabilities: Object.keys(componentStatus)
    }, null, 2)}`);
    
    // Check for door lock capability
    const doorLockCap = capabilities.find(cap => cap.id === 'doorControl' || cap.id === 'lock');
    const doorStatusCap = doorLockCap ? componentStatus[doorLockCap.id] : undefined;
    const doorStatus = getCapabilityAttributeValue(doorStatusCap, 'door') || getCapabilityAttributeValue(doorStatusCap, 'lock');
    if (doorStatus !== undefined) {
      debugLog(`✅ Resolved ${deviceId} status from ${doorLockCap.id}: ${doorStatus}`);
      return doorStatus;
    }

    // Check for contact sensor capability
    const contactCap = capabilities.find(cap => cap.id === 'contactSensor');
    const contactStatusCap = contactCap ? componentStatus[contactCap.id] : undefined;
    const contactStatus = getCapabilityAttributeValue(contactStatusCap, 'contact');
    if (contactStatus !== undefined) {
      debugLog(`✅ Resolved ${deviceId} status from contactSensor: ${contactStatus}`);
      return contactStatus;
    }

    // Check for generic switch capability
    const switchCap = capabilities.find(cap => cap.id === 'switch');
    const switchStatusCap = switchCap ? componentStatus[switchCap.id] : undefined;
    const switchStatus = getCapabilityAttributeValue(switchStatusCap, 'switch');
    if (switchStatus !== undefined) {
      debugLog(`✅ Resolved ${deviceId} status from switch: ${switchStatus}`);
      return switchStatus;
    }

    console.warn(`⚠️  No recognized capability found for device ${deviceId}`);
    debugLog(`💡 Enable DEBUG_LOGGING=true to inspect SmartThings capabilities and status payloads.`);
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
    debugLog(`🔍 Checking ${devicesToCheck.length} device(s) scheduled for ${checkAtTime}...`);
  } else {
    debugLog(`🔍 Checking ${devicesToCheck.length} monitored device(s)...`);
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
      debugLog(`✅ ${deviceConfig.name} is closed`);
    } else if (status) {
      debugLog(`ℹ️  ${deviceConfig.name} status: ${status}`);
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
    debugLog('✅ All monitored devices are closed - all good!');
    return {
      openDevices,
      notificationSent: false,
      message: null
    };
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

  return {
    openDevices,
    notificationSent: true,
    message
  };
}

function getSubscriptionDeviceEvents(payload) {
  const events = payload?.eventData?.events || payload?.events || [];

  return events
    .filter(event => event.eventType === 'DEVICE_EVENT' && event.deviceEvent)
    .map(event => event.deviceEvent);
}

function isOpenStatus(status) {
  return status === 'open' || status === 'detected';
}

function getVirtualDeviceTriggerConfig(deviceEvent) {
  if (
    (deviceEvent.componentId || 'main') !== 'main'
    || deviceEvent.capability !== 'switch'
    || deviceEvent.attribute !== 'switch'
    || deviceEvent.value !== 'on'
  ) {
    return null;
  }

  return MONITORED_DEVICES.find(device => device.virtualDeviceId === deviceEvent.deviceId) || null;
}

async function handleVirtualDeviceTrigger(deviceConfig) {
  try {
    debugLog(`🔔 Virtual trigger received for ${deviceConfig.name}; checking associated device ${deviceConfig.id}`);

    const status = await checkDeviceStatus(deviceConfig.id);

    if (isOpenStatus(status)) {
      const message = `${deviceConfig.name} is still open`;
      console.warn(`⚠️  ${message}`);
      await sendPushoverNotification(message);
    } else if (status === 'closed' || status === 'clear') {
      debugLog(`✅ ${deviceConfig.name} is closed`);
    } else if (status) {
      debugLog(`ℹ️  ${deviceConfig.name} status: ${status}`);
    }
  } catch (error) {
    console.error(`❌ Failed to handle virtual trigger for ${deviceConfig.name}:`, error.message);
  } finally {
    await turnOffVirtualDevice(deviceConfig.virtualDeviceId, deviceConfig.name);
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
      debugLog(`⏰ Running scheduled check at ${checkTime}...`);
      handleDeviceCheck(checkTime);
    });

    scheduledJobs.push({ time: checkTime, job });
    debugLog(`📅 Scheduled device check at ${checkTime} (cron: ${cronExpression})`);
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
  app.get('/webhook/routine-triggered', async (req, res) => {
    const { routineId, routineName } = req.query;
    
    debugLog(`🔔 Routine triggered: ${routineName} (${routineId})`);
    
    if (routineId === ROUTINE_ID || routineName?.includes('Go To Bed')) {
      debugLog('🛏️  "Go To Bed" routine detected - checking ALL devices...');
      // When routine triggers, check ALL devices regardless of their scheduled checkTime
      await handleDeviceCheck(null);
    } else {
      debugLog(`ℹ️  Routine triggered but it does not match the configured "Go To Bed" routine (ID: ${ROUTINE_ID})`);
    }

    res.json({ success: true });
  });

  // SmartThings subscription endpoint - called when monitored virtual trigger devices turn on
  app.post('/smartthings/events', async (req, res) => {
    const lifecycle = req.body?.lifecycle;

    if (lifecycle && lifecycle !== 'EVENT') {
      debugLog(`ℹ️  Ignoring SmartThings lifecycle: ${lifecycle}`);
      return res.json({ success: true });
    }

    const triggeredDeviceConfigs = getSubscriptionDeviceEvents(req.body)
      .map(getVirtualDeviceTriggerConfig)
      .filter(Boolean);

    if (triggeredDeviceConfigs.length === 0) {
      debugLog('ℹ️  SmartThings event received but it did not match any monitored virtual trigger device');
      return res.json({ success: true, checked: false });
    }

    const uniqueDeviceConfigs = [
      ...new Map(triggeredDeviceConfigs.map(device => [device.virtualDeviceId, device])).values()
    ];

    for (const deviceConfig of uniqueDeviceConfigs) {
      await handleVirtualDeviceTrigger(deviceConfig);
    }

    res.json({ success: true, checked: true, checkedCount: uniqueDeviceConfigs.length });
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

  // Endpoint to test the full alert flow on-demand
  app.all('/test', async (req, res) => {
    // Optional query parameter: ?time=HH:MM to test only devices scheduled for that time
    const checkTime = req.query.time || null;
    const result = await handleDeviceCheck(checkTime);

    res.json({
      timestamp: new Date().toISOString(),
      checkTime: checkTime || 'all',
      monitoredCount: MONITORED_DEVICES.length,
      notificationSent: result.notificationSent,
      message: result.message,
      openDevices: result.openDevices
    });
  });

  app.listen(PORT, () => {
    debugLog(`🚀 Webhook server listening on port ${PORT}`);
    debugLog(`   Health check: http://<your-nas-ip>:${PORT}/health`);
    debugLog(`   Manual check: http://<your-nas-ip>:${PORT}/check (GET or POST)`);
    debugLog(`   Full alert test: http://<your-nas-ip>:${PORT}/test (GET or POST)`);
    debugLog(`   Routine trigger event: POST http://<your-nas-ip>:${PORT}/smartthings/events`);
  });

  return app;
}

/**
 * Initialize the application
 */
async function initialize() {
  debugLog('🚀 Starting Device Monitor...');
  debugLog(`📱 Using SmartThings API Token: ${ST_API_TOKEN?.substring(0, 10)}...`);
  
  // Check Pushover configuration
  if (!PUSHOVER_USER_KEY || !PUSHOVER_API_TOKEN) {
    console.warn('⚠️  Pushover not configured - notifications will be limited');
  } else {
    debugLog('✅ Pushover configured - Emergency priority notifications enabled');
  }

  debugLog(`📊 Monitoring ${MONITORED_DEVICES.length} device(s):`);
  
  MONITORED_DEVICES.forEach((device, index) => {
    const checkTime = device.checkTime || '21:00';
    debugLog(`   ${index + 1}. ${device.name} (${device.id}) - Check at ${checkTime}`);
    if (device.virtualDeviceId) {
      debugLog(`      → Virtual trigger device: ${device.virtualDeviceId}`);
    }
  });

  if (MONITORED_DEVICES.length === 0) {
    console.error('❌ No devices configured! Please add devices to MONITORED_DEVICES in .env');
    process.exit(1);
  }

  try {
    // Verify API token works
    const devices = await client.devices.list();
    debugLog(`✅ Connected to SmartThings - found ${devices.length} total device(s)`);

    // Verify all monitored devices exist
    for (const deviceConfig of MONITORED_DEVICES) {
      const device = await getDevice(deviceConfig.id);
      if (!device) {
        throw new Error(`Device not found: ${deviceConfig.name} (${deviceConfig.id})`);
      }
      debugLog(`✅ ${deviceConfig.name} found`);

      // Verify virtual device if configured
      if (deviceConfig.virtualDeviceId) {
        const virtualDevice = await getDevice(deviceConfig.virtualDeviceId);
        if (!virtualDevice) {
          throw new Error(`Virtual device not found for ${deviceConfig.name} (${deviceConfig.virtualDeviceId})`);
        }
        debugLog(`   ✅ Virtual device found (${virtualDevice.name})`);
      }
    }

    // Start services
    schedulePeriodicChecks();
    startWebhookServer();

  } catch (error) {
    console.error('❌ Initialization failed:', error.message);
    process.exit(1);
  }
}

// Start the app
initialize();
