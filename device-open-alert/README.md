# Multi-Device Monitor - SmartThings + Pushover + Alexa Routine Triggers

A Node.js service that monitors multiple doors/devices via SmartThings API and:
- Checks devices at **specific times throughout the day** (configurable per device, default 9pm)
- Checks **ALL devices** when your **"Go To Bed" routine** runs
- Sends **Emergency Priority Pushover notifications** when devices are found open
- Optionally triggers **Alexa routines via SmartThings virtual devices**
- Provides manual check via REST API endpoint

## Features

✅ Monitors multiple doors/windows/devices via SmartThings API  
✅ **Scheduled checks at different times per device** (or use same time for all)  
✅ **Check ALL devices when "Go To Bed" routine runs**  
✅ **Emergency Priority Pushover notifications** - pushes through silent/muted phones  
✅ **Virtual device workaround** to trigger Alexa routines (since direct Alexa integration unavailable)  
✅ On-demand checks via REST API endpoint  
✅ Runs on Synology NAS (Docker or Node.js)  
✅ RESTful webhook for routine integration  
✅ Health check & status endpoints  
✅ Support for door locks, contact sensors, and other capabilities  

## Prerequisites

- SmartThings account with devices already added
- A garage door sensor/lock connected to SmartThings
- **Pushover account** for Emergency Priority notifications
- _(Optional)_ SmartThings virtual devices + Alexa for routine triggering
- Synology NAS with Docker or Node.js installed
- Internet access for SmartThings and Pushover APIs

## Setup Instructions

### Step 1: Get Your SmartThings Personal Access Token

1. Go to https://account.smartthings.com/tokens
2. Click **"Generate new token"**
3. Give it a name like "Garage Door Monitor"
4. Select scopes:
   - `d:devicemanagementread` (read device info)
   - `d:deviceprofileread` (read device profiles)
   - `x:devices:*` (read all devices)
5. Click **Generate**
6. Copy the token (it will only show once!) and save it

### Step 2: Set Up Pushover Notifications

Pushover allows Emergency Priority notifications that push through silent/muted phones with a user acknowledgment requirement.

1. Create a free account at https://pushover.net
2. Get your **User Key**:
   - Log in to Pushover
   - Your User Key is shown on the main page
   - Copy and save it

3. Create an Application:
   - Go to https://pushover.net/apps
   - Click **"Create an Application/API Token"**
   - Fill in details:
     - **Name**: "SmartThings Door Monitor"
     - **Type**: "Application"
     - **Description**: "Monitor garage/door sensors"
     - **URL**: (optional) Leave blank or add your NAS IP
   - Click **"Create Application"**
   - Copy the **API Token**

4. Add to your `.env` file:
   ```
   PUSHOVER_USER_KEY=your_user_key_here
   PUSHOVER_API_TOKEN=your_api_token_here
   ```

5. Test Pushover:
   - Once running, the app will send Emergency Priority notifications to your phone
   - These **push through Do Not Disturb** mode automatically
   - You must acknowledge each notification on your phone

### Step 3: Get Device IDs

#### Option A: Using SmartThings Mobile App
1. Open SmartThings app
2. Go to **Devices** tab
3. Find each device you want to monitor → tap it → note the device name
4. Find your **Alexa device** → tap it → note the name

#### Option B: Using SmartThings API (Recommended)
Open your terminal and run:

```bash
# Replace with your token from Step 1
TOKEN="your_token_here"

# List all devices
curl -X GET "https://api.smartthings.com/v1/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq '.'
```

Look for each device you want to monitor and copy its `deviceId` value.

### Step 4: (Optional) Set Up Virtual Devices for Alexa Routine Triggering

**Note:** SmartThings cannot send notifications directly to Alexa devices. This is a workaround using virtual devices to trigger Alexa routines.

#### Create Virtual Devices in SmartThings:

1. In SmartThings app → **Settings** → **Developer Options**
2. Create a new virtual device:
   - Type: **Virtual Switch**
   - Name: Something descriptive like "Garage Door Alert"
3. Repeat for each device you want to alert on
4. Copy the virtual device IDs from SmartThings

#### Link Virtual Devices in Alexa Routines:

1. In **Alexa app** → **Routines**
2. Create a new routine:
   - **When**: Select **Smart Home** → **Device**
   - Choose the SmartThings virtual device you created
   - Select **Turns On** as the trigger
   - **Then**: Add actions like:
     - "Alexa, announce..." (voice announcement)
     - Play a sound
     - Send a notification
3. Repeat for each virtual device

#### Configure in `.env`:

Add `virtualDeviceId` to your devices:
```json
MONITORED_DEVICES=[
  {"id":"actual-garage-uuid","name":"Garage Door","virtualDeviceId":"virtual-alert-uuid"},
  {"id":"actual-front-uuid","name":"Front Door","virtualDeviceId":"virtual-front-uuid"},
  {"id":"actual-back-uuid","name":"Back Door"}
]
```

When any of these devices open, the monitor will:
1. Send a **Pushover Emergency Priority notification** to your phone
2. Toggle the virtual device to trigger the Alexa routine (if configured)

### Step 5: Configure Environment Variables

### Step 5: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in:
   ```
   SMARTTHINGS_TOKEN=your_personal_access_token_here
   PUSHOVER_USER_KEY=your_user_key_from_pushover
   PUSHOVER_API_TOKEN=your_api_token_from_pushover
   
   MONITORED_DEVICES=[
     {"id":"device-uuid-1","name":"Garage Door","checkTime":"21:00","virtualDeviceId":"virtual-uuid-1"},
     {"id":"device-uuid-2","name":"Front Door","checkTime":"18:00","virtualDeviceId":"virtual-uuid-2"},
     {"id":"device-uuid-3","name":"Back Door","checkTime":"21:00"}
   ]
   
   GO_TO_BED_ROUTINE_ID=routine-uuid (optional)
   PORT=3956
   ```

**Configuration Details:**
- `checkTime` - Optional time in 24-hour format (HH:MM) when to check each device
  - Default is `21:00` (9:00 PM) if not specified
  - Examples: `"09:00"` (9am), `"18:30"` (6:30pm), `"21:00"` (9pm)
- `virtualDeviceId` - Optional virtual device for Alexa routine triggering
- When `GO_TO_BED_ROUTINE_ID` runs, **ALL devices are checked** regardless of `checkTime`

**Important:**
- Keep the JSON format exactly as shown (with square brackets, curly braces, quotes)
- Add as many devices as you want - the app will monitor ALL of them
- Commas separate each device in the JSON array
- Each unique `checkTime` creates a separate cron job

### Step 6: Deploy on Synology NAS

#### Option A: Docker (Recommended)

1. Copy the entire `garage-monitor` folder to your NAS
2. SSH into your NAS:
   ```bash
   ssh admin@192.168.1.xxx
   ```

3. Navigate to the folder and start:
   ```bash
   docker-compose up -d
   ```

4. Check logs:
   ```bash
   docker-compose logs -f
   ```

#### Option B: Node.js on NAS

1. Copy the folder to your NAS
2. SSH into your NAS
3. Install and run:
   ```bash
   npm install
   npm start
   ```

### Step 7: Test It

1. Run a manual check:
   ```bash
   curl http://localhost:3000/health
   # Should return: {"status":"ok","uptime":...}
   ```

2. Check the logs for "Garage door is closed" or "Garage door is still open"

3. The app will automatically check at 9:00 PM every day

## Setting Up Routine Trigger (Optional)

To check the garage door when you run the **"Go To Bed" routine**:

### Option A: SmartThings Automation (Recommended - No Coding)

1. Open **SmartThings app** → **Automations**
2. Click **+** (Create new automation)
3. Select **"If"** → **"Routine"** → **"Go To Bed"**
4. Select **"Then"** → **"Make a request"** or **"Send notification"**
5. Point it to your webhook:
   ```
   POST http://<your-nas-ip>:3000/webhook/routine-triggered
   Body: {"routineName":"Go To Bed"}
   ```

### Option B: Direct Environment Variable

If you know your routine ID, add to `.env`:
```
GO_TO_BED_ROUTINE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

And the app will watch for that routine via subscriptions.

## Finding Routine IDs

```bash
TOKEN="your_token_here"

curl -X GET "https://api.smartthings.com/v1/routines" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq '.items[] | {id, name}'
```

## Managing Multiple Devices

## Managing Device Check Times

### Setting Different Check Times

You can check different devices at different times:

```json
MONITORED_DEVICES=[
  {"id":"garage-uuid","name":"Garage Door","checkTime":"06:00"},
  {"id":"front-uuid","name":"Front Door","checkTime":"18:00"},
  {"id":"back-uuid","name":"Back Door","checkTime":"21:00"},
  {"id":"window-uuid","name":"Master Window","checkTime":"21:00"}
]
```

This creates **3 separate cron jobs**:
- 6:00 AM - Check Garage Door
- 6:00 PM - Check Front Door
- 9:00 PM - Check Back Door & Master Window

### "Go To Bed" Routine Override

When your "Go To Bed" routine runs, the app **ignores individual checkTimes** and checks **ALL devices immediately**:

```bash
7:00 PM → Running "Go To Bed" routine
         → ALL devices checked, regardless of their checkTime setting
         → If any open → Pushover notification + virtual device trigger
```

### Adding More Devices

Simply add more entries to the `MONITORED_DEVICES` array in `.env`:

```json
MONITORED_DEVICES=[
  {"id":"garage-uuid","name":"Garage Door","checkTime":"21:00"},
  {"id":"front-uuid","name":"Front Door","checkTime":"18:00"},
  {"id":"back-uuid","name":"Back Door","checkTime":"21:00"},
  {"id":"window-uuid","name":"Master Bedroom Window","checkTime":"22:00"},
  {"id":"gate-uuid","name":"Front Gate","checkTime":"06:00"}
]
```

After updating `.env`, restart the application:
```bash
# Docker
docker-compose restart

# Node.js
# Press Ctrl+C then run: npm start
```

**When Checks Happen:**
1. **Scheduled Times** - Each device is checked at its configured `checkTime`
   - Garage Door at 9pm → Notified if open
   - Front Door at 6pm → Notified if open
   - Back Door at 9pm → Notified if open
   
2. **"Go To Bed" Routine** - When this routine executes, **ALL devices are checked immediately** (regardless of their checkTime)

3. **On-Demand** - POST to `/check` endpoint to check devices manually

**Pushover Emergency Priority:**
- Bypasses phone's Do Not Disturb / Silent mode
- Shows yellow notification alert
- Requires user acknowledgment
- Retry every 60 seconds for 5 minutes if not acknowledged

**Virtual Device Trigger:**
- If configured, toggles virtual device ON/OFF to trigger Alexa routines
- Alexa routine can then announce, play sounds, or send notifications

**Message Format:**
- If **1 device is open**: "Garage Door is still open"
- If **multiple devices are open**: "3 devices still open: Garage Door, Front Door, Back Door"
- If **all devices are closed**: No notification sent

### Performance Notes

- Each device check makes ONE API call to SmartThings
- 10 devices = 10 API calls per nightly check (at 9pm)
- SmartThings API typically responds in <500ms per device
- Total check time for 10 devices: ~5 seconds

## Troubleshooting

### Pushover Notifications Not Working
- Verify `PUSHOVER_USER_KEY` and `PUSHOVER_API_TOKEN` are correct
- Check that Pushover is enabled on your phone
- Make sure you've set the app's notification priority correctly in Pushover settings
- Test manually: Visit https://pushover.net and send a test notification
- Check logs: `docker-compose logs garage-door-monitor`

### Virtual Device Trigger Not Working
- Verify `virtualDeviceId` in `.env` is correct
- Confirm the virtual device exists in SmartThings app
- Check that the Alexa routine is properly configured to trigger on "device turns on"
- Make sure the virtual device has the "switch" capability
- Check logs for virtual device errors

### "Device not found"
- Verify `MONITORED_DEVICES` array contains correct device UUIDs
- Confirm all devices are still in SmartThings app
- Run: `curl http://localhost:3000/health`

### JSON parse error in `.env`
- Make sure the JSON format is exactly right
- Check for matching brackets: `[` and `]`
- Check for matching braces: `{` and `}`
- Check for commas between devices
- Use a JSON validator online if unsure

### No notifications being sent
- Check that Pushover is configured (not required but recommended)
- Verify SmartThings token is valid
- Review the error message in logs
- Ensure JSON format in MONITORED_DEVICES is valid

### App crashes on startup
- Verify your SmartThings token is valid
- Check all device IDs are correct UUIDs (not names)
- Verify all virtual device IDs exist
- Review the error message in logs
- Ensure JSON format in MONITORED_DEVICES is valid

## Logs

View logs:
```bash
# Docker
docker-compose logs -f garage-door-monitor

# Node.js
npm start
```

## Architecture

```
Synology NAS
    ↓
Node.js Service (device-monitor)
    ├─ SmartThings API (list & check devices)
    ├─ Cron Jobs (scheduled checks at different times)
    ├─ Webhook Server (listen for routine triggers - checks ALL devices)
    ├─ REST API (on-demand checks via /check endpoint)
    ├─ Pushover API (Emergency Priority notifications)
    └─ SmartThings Virtual Devices (trigger Alexa routines)
         ↓
    SmartThings Cloud
         ├─ Check device status
         ├─ Update virtual devices
         └─ Execute commands
```

### How It Works

1. **Per-Device Scheduled Checks**
   - Each device has a `checkTime` (default: 21:00)
   - Garage Door scheduled for 9pm → Checked at 9pm daily
   - Front Door scheduled for 6pm → Checked at 6pm daily
   - Back Door scheduled for 9pm → Checked at 9pm daily
   - Each unique time creates a separate cron job

2. **Routine Trigger (Go To Bed)**
   - When routine executes → Check **ALL devices immediately** (ignores checkTime)
   - Useful for bedtime verification regardless of device's scheduled time

3. **Notification Logic**
   - If ANY checked device is open:
     - Sends **Emergency Priority Pushover notification** (pushes through silent phone)
     - Toggles configured virtual devices to trigger Alexa routines

4. **On-Demand**
   - External systems can POST to `/check` endpoint for immediate device status
   - Optional `?time=HH:MM` parameter to check only devices scheduled for that time

### Device Capability Support

The app detects and reports status for:
- **Door Locks** - `doorControl` capability (open/closed)
- **Contact Sensors** - `contactSensor` capability (open/closed)
- **Magnetic Sensors** - Detects open/closed state
- **Smart Switches** - Can be used as sensors (on/off)

Any SmartThings device with a capability to report open/closed state can be monitored.

## API Endpoints

### GET `/health`
Health check endpoint
```bash
curl http://localhost:3000/health
# Response: {"status":"ok","uptime":1234.56,"monitoredDevices":3}
```

### POST `/check`
Manually trigger a check of all monitored devices (or specific time)
```bash
# Check all devices regardless of checkTime
curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json"

# Check only devices scheduled for a specific time
curl -X POST "http://localhost:3000/check?time=21:00" \
  -H "Content-Type: application/json"

# Response: {"timestamp":"2026-05-12T20:30:00Z","checkTime":"21:00","monitoredCount":3,"openDevices":[...]}
```

### POST `/webhook/routine-triggered`
Called when a routine executes (for "Go To Bed" automation)
```bash
curl -X POST http://localhost:3000/webhook/routine-triggered \
  -H "Content-Type: application/json" \
  -d '{"routineName":"Go To Bed","routineId":"..."}'
```

## Files

- `index.js` - Main application
- `package.json` - Node.js dependencies
- `docker-compose.yml` - Docker deployment config
- `Dockerfile` - Container image definition
- `.env` - Configuration (create from .env.example)

## Security Notes

⚠️ **Keep your `.env` file private!** It contains your SmartThings API token.

- Never commit `.env` to git
- Use strong passwords for Synology NAS SSH
- Consider limiting webhook access with IP whitelisting
- Store tokens in a secure location

## License

MIT

## Support

For SmartThings API issues, see: https://smartthings.developer.samsung.com/docs/api-ref/  
For Synology NAS Docker: https://docs.synology.com/
