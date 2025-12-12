# DevLens

Debug any mobile app - logs, network, storage. No SDK required.

🔒 **Privacy First:** All data stays on your machine. We don't collect or store anything.

```bash
npx devlens
```

## Why DevLens?

To see logs from your physical Android/iOS device, you normally need to:
- **Android:** Open Android Studio → Connect device → Open Logcat
- **iOS:** Open Xcode → Connect device → Open Console

That's a 2-3 GB IDE (or 15+ GB for Xcode) just to see logs!

**With DevLens:** USB connect → `npx devlens` → See logs in browser. That's it.

| Without DevLens | With DevLens |
|-----------------|--------------|
| Open Android Studio / Xcode | Just `npx devlens` |
| 2-15 GB IDE install | No IDE needed |
| Wait 2-5 min for IDE to load | Ready in 5 seconds |
| Need project/source code | Works with any installed app |

**Use cases:**
- 🔧 **Quick debugging** - Don't want to open heavy IDE just for logs
- 🧪 **QA testing** - Test debug builds without any IDE knowledge
- 📱 **Client's phone** - Plug their device, see logs, fix issue
- ⚡ **React Native / Flutter** - See native logs alongside JS logs

## Features

| Feature                | Android | iOS |
| ---------------------- | ------- | --- |
| Device Detection       | ✅      | ✅  |
| App List               | ✅      | ✅  |
| Real-time Logs         | ✅      | ✅  |
| Network Capture        | ✅      | ❌  |
| Storage (debug builds) | ✅      | ✅  |

## Installation

```bash
# Run directly with npx (no install needed)
npx devlens

# Or install globally
npm install -g devlens
devlens
```

## Requirements

### Android

- USB Debugging enabled on device
- ADB installed (`brew install android-platform-tools` on macOS)

### iOS

- Device connected via USB
- libimobiledevice installed (`brew install libimobiledevice` on macOS)

## Usage

### 1. Start DevLens

```bash
npx devlens
```

This will:

- Detect connected devices
- Start dashboard on port 3000
- Open browser automatically

### 2. Connect Your Device

**Android:**

1. Enable USB Debugging in Developer Options
2. Connect device via USB
3. Accept USB debugging prompt on device

**iOS:**

1. Connect device via USB
2. Trust the computer on device

### 3. View Logs

1. Select device from dropdown
2. Select app (optional - filters logs to that app only)
3. Logs stream in real-time

### 4. Capture Network Traffic (Android)

1. Click the **"Network: OFF"** button in the dashboard header
2. Confirm the warning prompt
3. Network requests will appear in the Network tab

**⚠️ IMPORTANT:** Turn OFF network capture before disconnecting USB! Otherwise your phone's internet will stop working.

**If you forgot to turn it off:**
- Reconnect USB and turn it OFF from dashboard, OR
- On phone: WiFi Settings → Your network → Proxy → None

### 5. View Storage

1. Select device and app
2. Go to Storage tab
3. Click "Load Storage"

> Note: Storage access only works for debuggable apps (debug builds)

## CLI Options

```bash
devlens [options]

Options:
  -V, --version        output the version number
  -p, --port <port>    Dashboard port (default: "3000")
  --proxy-port <port>  Proxy port (default: "8080")
  --no-open            Do not open browser automatically
  -h, --help           display help for command
```

## Architecture

```
Phone (Any App)
      │
      ├── USB ──► ADB/libimobiledevice ──► Logs
      │
      └── System Proxy ──► DevLens Proxy ──► Network Requests
                              │
                              ▼
                    ┌─────────────────┐
                    │  Local Server   │
                    │  (port 3000)    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Dashboard     │
                    │   (Browser)     │
                    └─────────────────┘
```

## Limitations

### Logs

- **Android:** Works for all apps
- **iOS:** Limited to system logs, app-specific logs may not be visible

### Network

- HTTP requests: Full visibility (headers, body, response)
- HTTPS requests: Domain and timing only (no MITM)
- Some security-conscious apps may detect and block proxy

### Storage

- Only works for debuggable apps (debug/staging builds)
- Play Store / App Store apps storage not accessible

## Tech Stack

- Node.js + TypeScript
- Express + Socket.io
- ADB (Android)
- libimobiledevice (iOS)

## Author

**Sayed Abdul Karim**

## License

MIT
