# Quick Start Guide - Multi-Device Monitor

## 1️⃣ Get Your SmartThings Token (5 minutes)

1. Open browser and go to: **https://account.smartthings.com/tokens**
2. Click **"Generate new token"**
3. Name it: `Device Monitor`
4. Select these scopes (check the boxes):
   - ✅ `d:devicemanagementread`
   - ✅ `d:deviceprofileread`
   - ✅ `x:devices:*`
5. Click **Generate**
6. **SAVE THIS TOKEN!** (You'll only see it once)
   - Copy it and paste into Notepad temporarily

## 2️⃣ Find Your Device IDs (5 minutes)

**On your Windows PC:**

1. Open Command Prompt (Win + R, type `cmd`, press Enter)
2. Navigate to the `garage-monitor` folder:
   ```
   cd C:\Users\philg\Syno_Phil\www\SmartThings\garage-monitor
   ```
3. Run:
   ```
   get-device-ids.bat "your_token_from_step_1_here"
   ```
4. You'll see a list of all your devices. Find and note:
   - **Garage Door** → Copy its `id`
   - **Front Door** → Copy its `id`
   - **Any other door sensors** → Copy their `id`
   - **Alexa device** → Note its `name` (e.g., "Bedroom Alexa")

## 3️⃣ Create Configuration File (2 minutes)

1. In VS Code, open: `garage-monitor` folder
2. Rename `.env.example` to `.env` (right-click → Rename)
3. Edit `.env` and fill in:
   ```
   SMARTTHINGS_TOKEN=paste_your_token_here
   MONITORED_DEVICES=[
     {"id":"garage-door-uuid-here","name":"Garage Door"},
     {"id":"front-door-uuid-here","name":"Front Door"},
     {"id":"back-door-uuid-here","name":"Back Door"}
   ]
   ALEXA_DEVICE_NAME=Alexa
   PORT=3000
   ```
   
   **Tips:**
   - Include as many devices as you want (doors, windows, etc.)
   - Keep the JSON format exactly as shown
   - Each device needs an `id` and `name`

4. Save the file (Ctrl + S)

## 4️⃣ Test Locally on Your PC (5 minutes)

Before deploying to NAS, test it works:

1. Open Terminal in VS Code (Ctrl + `)
2. Run:
   ```
   npm install
   npm start
   ```
3. You should see:
   ```
   ✅ Connected to SmartThings - found X device(s)
   ✅ Garage Door found
   ✅ Front Door found
   📋 Performing initial device check...
   ✅ Garage Door is closed
   ✅ Front Door is closed
   ```

4. Press Ctrl+C to stop

## 5️⃣ Deploy to Synology NAS (10 minutes)

### Option A: Using Docker (Recommended)

1. SSH into your NAS:
   ```
   ssh admin@<your-nas-ip>
   ```

2. Copy your entire `garage-monitor` folder to NAS (use WinSCP or similar)

3. Navigate to the folder and start:
   ```
   docker-compose up -d
   ```

4. Check it's running:
   ```
   docker-compose logs -f
   ```

### Option B: Using Node.js on NAS

1. SSH into your NAS
2. Navigate to the `garage-monitor` folder
3. Run:
   ```
   npm install
   npm start
   ```

## 6️⃣ Verify It's Working (5 minutes)

1. Open your browser and go to:
   ```
   http://<your-nas-ip>:3000/health
   ```
   You should see: 
   ```json
   {"status":"ok","uptime":...,"monitoredDevices":3}
   ```

2. Check the logs - should show all devices checked at startup

3. Trigger a manual check (optional):
   ```
   curl -X POST http://<your-nas-ip>:3000/check \
     -H "Content-Type: application/json"
   ```

## 7️⃣ Test Alexa Notification (Optional - 5 minutes)

To manually test a notification:

1. Open terminal on your NAS
2. Run:
   ```
   curl -X POST http://localhost:3000/webhook/routine-triggered \
     -H "Content-Type: application/json" \
     -d '{"routineName":"Test","routineId":"test-id"}'
   ```

3. Check if Alexa received a notification

## 8️⃣ Set Up Routine Trigger (Optional - 10 minutes)

To trigger when you run "Go To Bed" routine:

1. Open **SmartThings app** on your phone
2. Go to **More (⋯)** → **Automations**
3. Tap **+** to create new automation
4. Select **"If"** → **"Routine"** → **"Go To Bed"**
5. Select **"Then"** → **"Send notification"** or **"Make a request"**
6. For webhook: Enter your NAS URL:
   ```
   http://<your-nas-ip>:3000/webhook/routine-triggered
   ```

✅ **That's it!** Your multi-device monitor is running!

## Daily Schedule

- **9:00 PM** - Automatic check every day (Alexa notification if any device is open)
- **Anytime** - Manual check via `POST /check` endpoint
- **Anytime** - Trigger via "Go To Bed" routine or webhook

## Monitoring Multiple Devices

Add as many devices as you want to `MONITORED_DEVICES`:

```json
MONITORED_DEVICES=[
  {"id":"uuid1","name":"Garage Door"},
  {"id":"uuid2","name":"Front Door"},
  {"id":"uuid3","name":"Back Door"},
  {"id":"uuid4","name":"Basement Window"},
  {"id":"uuid5","name":"Master Bedroom"}
]
```

The app will check ALL of them and notify if ANY are open.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Alexa device not found" | Double-check `ALEXA_DEVICE_NAME` in `.env` matches exactly |
| "Device not found" | Run `get-device-ids.bat` again to verify the IDs are correct UUIDs |
| JSON parse error in `.env` | Make sure the JSON array format is exactly right (check commas, quotes, brackets) |
| App won't start | Check token is valid, all device IDs are correct UUIDs |
| No notification sent | Verify Alexa device is connected to SmartThings |

Need more help? See `README.md` for detailed documentation.
