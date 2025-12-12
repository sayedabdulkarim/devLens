# DevLens - Mobile Debug Tool

## Goal
Generic mobile debugging tool - network requests, logs, storage dekhne ke liye bina Android Studio/Xcode ke.

```
$ npx devlens
```

---

## Architecture

```
Phone (Any App) ──► Proxy + ADB/iOS ──► Local Server ──► Browser Dashboard
```

---

## Features

| Feature | Android | iOS | Method |
|---------|---------|-----|--------|
| Network Requests | ✅ | ✅ | Built-in Proxy (mitmproxy) |
| Logs | ✅ | ⚠️ | ADB logcat / idevicesyslog |
| Storage | ⚠️ Debug builds | ⚠️ Debug builds | adb run-as / ifuse |
| Device List | ✅ | ✅ | ADB / libimobiledevice |
| App List | ✅ | ✅ | pm list / ideviceinstaller |

---

## Tasks

### Phase 1: Project Setup
- [x] Initialize npm package
- [x] Setup TypeScript config
- [x] Setup project structure
- [x] Add CLI entry point (bin)

### Phase 2: Device Detection
- [x] Android: Detect connected devices via ADB
- [x] iOS: Detect connected devices via libimobiledevice
- [x] List installed apps (Android)
- [x] List installed apps (iOS)

### Phase 3: Log Capture
- [x] Android: Stream logs via `adb logcat`
- [x] Android: Filter logs by package/PID
- [x] iOS: Stream logs via `idevicesyslog`
- [x] iOS: Filter logs by process

### Phase 4: Network Proxy
- [x] Setup HTTP proxy server
- [x] Setup HTTPS proxy with CA certificate
- [x] Capture request/response data
- [x] Generate & export CA cert for phone install

### Phase 5: Storage Access (Debug Builds)
- [x] Android: Read SharedPreferences via `adb run-as`
- [x] Android: Read AsyncStorage (React Native)
- [x] iOS: Read app data via ifuse (debuggable apps)

### Phase 6: Local Server + WebSocket
- [x] HTTP server for dashboard
- [x] WebSocket for real-time data streaming
- [x] API endpoints for device/app info

### Phase 7: Dashboard UI
- [x] Device selector dropdown
- [x] App selector dropdown
- [x] Logs tab (filterable, searchable)
- [x] Network tab (Chrome DevTools style)
- [x] Storage tab (key-value viewer)
- [x] Real-time updates via WebSocket

### Phase 8: CLI Polish
- [x] Pretty terminal output (ora, chalk)
- [x] Auto-open browser
- [x] Help command
- [x] Version command

### Phase 9: Publish
- [ ] npm publish
- [x] README with usage instructions
- [ ] Landing page (optional)

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| CLI | Node.js + TypeScript |
| Android | ADB (child_process) |
| iOS | libimobiledevice (child_process) |
| Proxy | Custom HTTP/HTTPS proxy |
| Server | Express + Socket.io |
| Dashboard | HTML + Tailwind CSS |
| Bundler | tsup |

---

## Folder Structure

```
devlens/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
├── src/
│   ├── index.ts
│   ├── bin/
│   │   └── cli.ts              # Entry point
│   ├── android/
│   │   ├── devices.ts          # Device detection
│   │   ├── logs.ts             # Logcat streaming
│   │   └── storage.ts          # Storage access
│   ├── ios/
│   │   ├── devices.ts          # Device detection
│   │   ├── logs.ts             # idevicesyslog
│   │   └── storage.ts          # Storage access
│   ├── proxy/
│   │   ├── server.ts           # Proxy server
│   │   └── certificate.ts      # CA cert generation
│   └── server/
│       └── index.ts            # Express + Socket.io
└── dashboard/
    └── index.html              # Web UI
```

---

## Commands

```bash
# Development
npm run dev

# Build
npm run build

# Test locally
npm link && devlens

# Publish
npm publish
```
