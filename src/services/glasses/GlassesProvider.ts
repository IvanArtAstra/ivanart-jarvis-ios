/**
 * GlassesProvider.ts — Unified interface for Ray-Ban Meta Smart Glasses
 * 
 * Two implementations:
 *   1. BLEProvider  — Nordic UART (low-level, fallback)
 *   2. MetaSDKProvider — Meta Wearables SDK (full features)
 * 
 * ConnectionManager routes calls to the best available provider.
 */

// ─── Capability Map ─────────────────────────────────────────────────────────

export interface ProviderCapabilities {
  textCommands: boolean;    // Send/receive text
  camera: boolean;          // Capture photo from glasses
  video: boolean;           // Record video
  audioStream: boolean;     // Real-time audio streaming
  display: boolean;         // Show cards/notifications on glasses display
  gestures: boolean;        // Touchpad gesture events
  voiceCommands: boolean;   // Registered voice triggers
  batteryInfo: boolean;     // Battery level reporting
  led: boolean;             // LED control
}

// ─── Data Types ─────────────────────────────────────────────────────────────

export type ConnectionMode = 'ble' | 'sdk' | 'auto';

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export type LEDState = 'off' | 'idle' | 'recording' | 'thinking' | 'notification' | 'error';

export interface GlassesInfo {
  name: string;
  deviceId: string;
  batteryLevel: number;       // 0-100, -1 if unknown
  firmwareVersion: string;
  isRecording: boolean;
  signalStrength: number;     // dBm, 0 if unknown
  provider: 'ble' | 'sdk';
}

export interface MediaAsset {
  uri: string;                // Local file URI
  mimeType: string;           // image/jpeg, video/mp4, audio/wav
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes: number;
  timestamp: number;
}

export interface DisplayCard {
  title: string;
  body: string;
  icon?: string;              // Emoji or icon name
  speakText?: string;         // TTS on glasses
  durationMs?: number;        // How long to show
  ledPattern?: LEDState;
}

export interface GestureEvent {
  type: 'tap' | 'double_tap' | 'long_press' | 'swipe_forward' | 'swipe_back';
  timestamp: number;
}

// ─── Event Callbacks ────────────────────────────────────────────────────────

export interface GlassesEventHandlers {
  onStateChange?: (state: ConnectionState) => void;
  onMessage?: (text: string) => void;
  onGesture?: (gesture: GestureEvent) => void;
  onVoiceCommand?: (commandId: string) => void;
  onMediaCaptured?: (asset: MediaAsset) => void;
  onBatteryUpdate?: (level: number) => void;
  onError?: (error: Error) => void;
}

// ─── Provider Interface ─────────────────────────────────────────────────────

export interface IGlassesProvider {
  readonly type: 'ble' | 'sdk';
  readonly state: ConnectionState;
  readonly capabilities: ProviderCapabilities;
  readonly info: GlassesInfo | null;

  // Lifecycle
  initialize(): Promise<boolean>;
  scan(): Promise<boolean>;
  connect(deviceId?: string): Promise<boolean>;
  disconnect(): Promise<void>;
  destroy(): void;

  // Text (BLE + SDK)
  sendText(message: string): Promise<void>;

  // Camera (SDK only)
  capturePhoto(): Promise<MediaAsset>;
  startVideoCapture(): Promise<void>;
  stopVideoCapture(): Promise<MediaAsset>;

  // Audio (SDK only)
  startAudioStream(onChunk: (data: ArrayBuffer) => void): Promise<void>;
  stopAudioStream(): Promise<void>;

  // Display (SDK only)
  showOnDisplay(card: DisplayCard): Promise<void>;
  clearDisplay(): Promise<void>;

  // LED (SDK only, partial BLE)
  setLED(state: LEDState): Promise<void>;

  // Battery
  getBatteryLevel(): Promise<number>;

  // Events
  setEventHandlers(handlers: GlassesEventHandlers): void;
}

// ─── Unsupported Error ──────────────────────────────────────────────────────

export class UnsupportedCapabilityError extends Error {
  constructor(provider: string, capability: string) {
    super(`${capability} is not supported by ${provider} provider`);
    this.name = 'UnsupportedCapabilityError';
  }
}
