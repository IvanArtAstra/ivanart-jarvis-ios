# IvanArt × Jarvis — Architecture Guide

## Overview

React Native iOS app for **Ray-Ban Meta Smart Glasses** — voice-first AI assistant with BLE connectivity, wake word detection, and multi-agent orchestration.

```
┌──────────────────────────────────────────────────────────┐
│                      iOS App                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │HomeScreen│  │Settings  │  │useJarvis │  │ Services  │ │
│  │  (UI)    │  │  Screen  │  │  (hook)  │  │  Layer    │ │
│  └────┬─────┘  └──────────┘  └────┬─────┘  └─────┬─────┘ │
│       │                           │               │       │
│  ┌────┴───────────────────────────┴───────────────┴────┐  │
│  │              Service Layer (12 modules)              │  │
│  │  voice · jarvis · tts · ble · wakeWord · background │  │
│  │  notification · agentBridge · commandParser · config │  │
│  │  appControl · metaWearables                         │  │
│  └──────────┬──────────┬──────────┬──────────┬─────────┘  │
└─────────────┼──────────┼──────────┼──────────┼────────────┘
              │          │          │          │
        ┌─────┴──┐  ┌───┴────┐ ┌──┴───┐  ┌──┴──────────┐
        │Claude  │  │Eleven  │ │BLE   │  │Agent Bridge │
        │API     │  │Labs TTS│ │UART  │  │WS :8766     │
        └────────┘  └────────┘ └──┬───┘  └─────────────┘
                                  │
                           ┌──────┴──────┐
                           │  Ray-Ban    │
                           │  Meta       │
                           │  Glasses    │
                           └─────────────┘
```

## Project Structure

```
ivanart-jarvis-ios/
├── index.js                 # RN entry point (AppRegistry)
├── App.tsx                  # Root component → HomeScreen
├── app.json                 # RN app config (name: IvanArtJarvis)
├── babel.config.js          # Metro bundler babel preset
├── metro.config.js          # Metro bundler config
├── tsconfig.json            # TypeScript config
├── package.json             # Dependencies (RN 0.73.0)
│
├── src/
│   ├── screens/
│   │   ├── HomeScreen.tsx   # Main UI — voice button, status, glasses card
│   │   └── SettingsScreen.tsx # Backend URL, voice ID config
│   │
│   ├── hooks/
│   │   └── useJarvis.ts     # Central state machine (AppState × ListenMode)
│   │
│   ├── services/
│   │   ├── voiceService.ts       # SFSpeechRecognizer wrapper
│   │   ├── jarvisService.ts      # Claude API (Anthropic)
│   │   ├── ttsService.ts         # ElevenLabs text-to-speech
│   │   ├── bleService.ts         # BLE UART for Ray-Ban Meta
│   │   ├── wakeWordService.ts    # "Джарвис" wake word detection
│   │   ├── backgroundService.ts  # Keep-alive for always-on mode
│   │   ├── notificationService.ts # Haptics + glasses notifications
│   │   ├── agentBridgeService.ts # WebSocket to agent orchestrator
│   │   ├── commandParserService.ts # Voice → agent command routing
│   │   ├── appControlService.ts  # iOS app launching (Shortcuts, etc.)
│   │   ├── metaWearablesService.ts # Meta Wearables SDK (AppID: 1261497052067859)
│   │   └── config.ts → utils/config.ts
│   │
│   ├── utils/
│   │   └── config.ts        # API keys, backend URLs, BLE settings
│   │
│   ├── assets/
│   │   ├── images/
│   │   └── sounds/
│   │
│   ├── store/               # State management (future)
│   ├── components/          # Reusable UI components (future)
│   └── types/               # TypeScript type definitions (future)
│
├── ios/
│   ├── IvanArtJarvis/
│   │   ├── AppDelegate.mm   # ObjC++ entry (moduleName: "IvanArtJarvis")
│   │   ├── Info.plist       # App permissions (BLE, microphone, speech)
│   │   └── main.m
│   ├── Podfile              # CocoaPods config
│   └── Podfile.lock
│
├── backend/
│   ├── agent_bridge.py      # WebSocket server (port 8766)
│   └── requirements.txt
│
├── scripts/
│   └── setup-ios.sh         # Setup automation
│
└── docs/
    ├── SETUP.md             # Dev setup guide
    └── ARCHITECTURE.md      # This file
```

## State Machine

`useJarvis.ts` manages a finite state machine:

```
          ┌─────────────────────────────────────┐
          │           MANUAL MODE               │
          │                                     │
          │  idle ──(button)──▶ listening        │
          │    ▲                    │            │
          │    └───(done)──── speaking           │
          │                    ▲                 │
          │                    └── thinking      │
          └─────────────────────────────────────┘

          ┌─────────────────────────────────────┐
          │          ALWAYS-ON MODE              │
          │                                     │
          │  wake_listen ─("Джарвис")──▶ listening│
          │       ▲                       │      │
          │       └────(done)──── speaking       │
          │                       ▲              │
          │                       └── thinking   │
          └─────────────────────────────────────┘
```

**States:**
| State | Description |
|-------|------------|
| `idle` | Manual mode rest. Button enabled. |
| `wake_listen` | Always-on: passively listening for "Джарвис" |
| `listening` | Actively capturing user speech (SFSpeechRecognizer) |
| `thinking` | Sent to Claude API, awaiting response |
| `speaking` | ElevenLabs TTS playing (+ BLE relay to glasses) |
| `error` | Error state, auto-recovers after 3s |

## Voice Pipeline

```
Microphone → SFSpeechRecognizer → Wake Word Check
                                        │
                          ┌─────────────┴──────────────┐
                          │                            │
                    "Джарвис" detected           Manual button press
                          │                            │
                          └─────────┬──────────────────┘
                                    ▼
                        Active Speech Recognition
                                    │
                          ┌─────────┴──────────────┐
                          │                        │
                   Agent command?            Normal query
                          │                        │
                   commandParser            Claude API
                   (instant)                (streaming)
                          │                        │
                          └──────────┬─────────────┘
                                     ▼
                              ElevenLabs TTS
                                     │
                          ┌──────────┴──────────┐
                          │                     │
                    iPhone speaker        BLE → Ray-Ban
                                          speakers
```

## BLE Protocol (Ray-Ban Meta)

```
Service UUID:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E  (Nordic UART)
TX Char:       6E400002-...  (phone → glasses)
RX Char:       6E400003-...  (glasses → phone)
```

**Communication flow:**
1. Scan for devices with name containing "ray-ban"
2. Connect and discover UART service
3. Send text via TX characteristic (max ~20 bytes per write, chunk if needed)
4. Glasses display notification or play audio

## Agent Bridge Protocol

WebSocket connection to `ws://<server>:8766`:

```json
// App → Bridge: voice command
{
  "type": "voice_command",
  "text": "Открой Telegram",
  "timestamp": "2026-03-16T12:00:00Z"
}

// Bridge → App: agent result push
{
  "type": "agent_result",
  "data": {
    "preview": "Задача выполнена: ...",
    "file": "prometheus_task_001.md"
  }
}
```

## Native Modules Required

For full Ray-Ban Meta integration, these native modules are needed:

| Module | Purpose | Status |
|--------|---------|--------|
| `react-native-ble-plx` | BLE UART communication | ✅ In deps |
| `@react-native-voice/voice` | Speech recognition | ✅ In deps |
| `react-native-sound` | Audio playback | ✅ In deps |
| `react-native-gesture-handler` | Navigation gestures | ✅ In deps |
| `react-native-screens` | Native navigation | ✅ In deps |
| Meta Wearables SDK | Official Meta glasses API | 🔧 Manual pod |

### Meta Wearables SDK Setup

1. Download SDK from Meta for Developers
2. Add to `ios/Podfile`:
   ```ruby
   pod 'MetaWearablesSDK', :path => '../libs/MetaWearablesSDK'
   ```
3. Configure `MWDAT.plist` with AppID: `1261497052067859`
4. Add `NSBluetoothAlwaysUsageDescription` to Info.plist

## Build & Run

```bash
# Prerequisites: Xcode 15+, CocoaPods, Node 18+
cd ~/Documents/ivanart-jarvis-ios
git pull origin master

# Install JS deps
npm install

# Install native pods
cd ios && pod install && cd ..

# Run in simulator
npx react-native run-ios

# Run on device (with signing)
npx react-native run-ios --device "iPhone de Ivan"
```

### Troubleshooting

| Error | Fix |
|-------|-----|
| `Unable to resolve module ./index` | Ensure `babel.config.js` exists with `@react-native/babel-preset` |
| Module name mismatch | `AppDelegate.mm` `moduleName` must match `app.json` `name` |
| Pods not found | `cd ios && pod install --repo-update` |
| BLE not working in simulator | BLE requires physical device |
| Metro cache stale | `npx react-native start --reset-cache` |

## Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...      # Claude API
ELEVENLABS_API_KEY=...            # TTS
JARVIS_VOICE_ID=pNInz6obpgDQGcFmaJgB  # Default voice
```

Store in `.env` file (requires `react-native-dotenv`) or configure in SettingsScreen.

## Connectivity Options

| Method | URL | Use Case |
|--------|-----|----------|
| Tailscale VPN | `ws://100.70.68.84:8766` | Anywhere (recommended) |
| Local network | `ws://192.168.X.X:8766` | Home WiFi only |
| bore.pub tunnel | `ws://<sub>.bore.pub:2200` | Public access |
| Localhost | `ws://localhost:8766` | Simulator testing |
