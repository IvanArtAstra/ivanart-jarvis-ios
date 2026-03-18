/**
 * MetaSDKProvider.ts — Meta Wearables SDK implementation of IGlassesProvider
 * 
 * Uses native module MetaWearables (bridged from Swift/ObjC).
 * Full capabilities: camera, video, audio, display, gestures, voice commands, LED.
 * 
 * App ID: 1261497052067859
 * Docs: https://wearables.developer.meta.com
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import {
  IGlassesProvider,
  ProviderCapabilities,
  ConnectionState,
  GlassesInfo,
  MediaAsset,
  DisplayCard,
  GestureEvent,
  LEDState,
  GlassesEventHandlers,
  UnsupportedCapabilityError,
} from './GlassesProvider';

// LED visual patterns
const LED_PATTERNS: Record<LEDState, { color: string; pattern: string }> = {
  off:          { color: 'none',  pattern: 'off' },
  idle:         { color: 'white', pattern: 'breathe_slow' },
  recording:    { color: 'red',   pattern: 'solid' },
  thinking:     { color: 'blue',  pattern: 'pulse_fast' },
  notification: { color: 'green', pattern: 'blink_3x' },
  error:        { color: 'red',   pattern: 'blink_fast' },
};

// Jarvis voice commands registered with Meta SDK
const VOICE_COMMANDS = [
  { commandId: 'jarvis_listen',  phrase: 'Джарвис',              description: 'Activate Jarvis' },
  { commandId: 'jarvis_status',  phrase: 'Джарвис, что сегодня', description: 'System status' },
  { commandId: 'jarvis_tasks',   phrase: 'Джарвис, задачи',      description: 'Task queue' },
  { commandId: 'jarvis_stop',    phrase: 'Стоп Джарвис',         description: 'Stop current op' },
  { commandId: 'jarvis_photo',   phrase: 'Джарвис, что я вижу',  description: 'Capture & analyze' },
  { commandId: 'jarvis_translate', phrase: 'Джарвис, переведи',  description: 'Translate what I see' },
  { commandId: 'jarvis_remember', phrase: 'Джарвис, запомни',    description: 'Save to memory' },
];

export class MetaSDKProvider implements IGlassesProvider {
  readonly type = 'sdk' as const;

  private eventEmitter: NativeEventEmitter | null = null;
  private nativeModule: any = null;
  private _state: ConnectionState = 'disconnected';
  private _info: GlassesInfo | null = null;
  private handlers: GlassesEventHandlers = {};
  private isAudioStreaming = false;
  private audioChunkCallback: ((data: ArrayBuffer) => void) | null = null;

  readonly APP_ID = '1261497052067859';
  readonly CLIENT_TOKEN = 'AR|1261497052067859|02adee6bcb50f0e9f0468b6708550e7d';

  get state(): ConnectionState { return this._state; }
  get info(): GlassesInfo | null { return this._info; }

  get capabilities(): ProviderCapabilities {
    return {
      textCommands: true,
      camera: true,
      video: true,
      audioStream: true,
      display: true,
      gestures: true,
      voiceCommands: true,
      batteryInfo: true,
      led: true,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async initialize(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      console.warn('[SDK] Meta Wearables SDK only available on iOS');
      return false;
    }

    try {
      const { MetaWearables } = NativeModules;
      if (!MetaWearables) {
        console.info('[SDK] Native module not found — SDK not installed');
        return false;
      }

      this.nativeModule = MetaWearables;
      await MetaWearables.initialize(this.APP_ID, this.CLIENT_TOKEN);

      // Set up event emitter
      this.eventEmitter = new NativeEventEmitter(MetaWearables);
      this.subscribeToNativeEvents();

      // Register voice commands
      await this.registerVoiceCommands();

      console.info('[SDK] ✅ Meta Wearables SDK initialized');
      return true;
    } catch (e: any) {
      console.warn('[SDK] Init failed:', e?.message ?? e);
      return false;
    }
  }

  async scan(): Promise<boolean> {
    if (!this.nativeModule) return false;
    
    this.setState('scanning');
    try {
      // SDK handles scanning internally
      const result = await this.nativeModule.startScanning?.();
      return result ?? true;
    } catch (e: any) {
      console.warn('[SDK] Scan failed:', e);
      this.setState('error');
      return false;
    }
  }

  async connect(deviceId?: string): Promise<boolean> {
    if (!this.nativeModule) return false;

    this.setState('connecting');
    try {
      if (deviceId) {
        await this.nativeModule.connectToDevice?.(deviceId);
      } else {
        await this.nativeModule.connectToLastDevice?.();
      }
      // Connected event will fire from native → handleConnected
      return true;
    } catch (e: any) {
      console.warn('[SDK] Connect failed:', e);
      this.setState('error');
      this.handlers.onError?.(e);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isAudioStreaming) await this.stopAudioStream();
    try {
      await this.nativeModule?.disconnect?.();
    } catch { /* already disconnected */ }
    this._info = null;
    this.setState('disconnected');
  }

  destroy(): void {
    this.disconnect();
    this.unsubscribeFromNativeEvents();
    this.eventEmitter = null;
    this.nativeModule = null;
  }

  // ─── Text Commands ──────────────────────────────────────────

  async sendText(message: string): Promise<void> {
    // SDK: send as notification with TTS
    await this.showOnDisplay({
      title: 'Jarvis',
      body: message,
      speakText: message,
      ledPattern: 'notification',
    });
  }

  // ─── Camera ─────────────────────────────────────────────────

  async capturePhoto(): Promise<MediaAsset> {
    if (!this.nativeModule?.capturePhoto) {
      throw new UnsupportedCapabilityError('SDK', 'camera (native module missing capturePhoto)');
    }

    try {
      await this.setLED('recording');
      const result = await this.nativeModule.capturePhoto();
      await this.setLED('idle');

      const asset: MediaAsset = {
        uri: result.uri,
        mimeType: result.mimeType ?? 'image/jpeg',
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes ?? 0,
        timestamp: Date.now(),
      };

      this.handlers.onMediaCaptured?.(asset);
      console.info(`[SDK] 📷 Photo captured: ${asset.uri}`);
      return asset;
    } catch (e: any) {
      await this.setLED('error');
      throw new Error(`Photo capture failed: ${e?.message ?? e}`);
    }
  }

  async startVideoCapture(): Promise<void> {
    if (!this.nativeModule?.startVideoCapture) {
      throw new UnsupportedCapabilityError('SDK', 'video');
    }

    await this.setLED('recording');
    await this.nativeModule.startVideoCapture();

    if (this._info) this._info.isRecording = true;
    console.info('[SDK] 🎥 Video recording started');
  }

  async stopVideoCapture(): Promise<MediaAsset> {
    if (!this.nativeModule?.stopVideoCapture) {
      throw new UnsupportedCapabilityError('SDK', 'video');
    }

    const result = await this.nativeModule.stopVideoCapture();
    await this.setLED('idle');

    if (this._info) this._info.isRecording = false;

    const asset: MediaAsset = {
      uri: result.uri,
      mimeType: result.mimeType ?? 'video/mp4',
      width: result.width,
      height: result.height,
      durationMs: result.durationMs,
      sizeBytes: result.sizeBytes ?? 0,
      timestamp: Date.now(),
    };

    this.handlers.onMediaCaptured?.(asset);
    console.info(`[SDK] 🎥 Video saved: ${asset.uri}`);
    return asset;
  }

  // ─── Audio Streaming ────────────────────────────────────────

  async startAudioStream(onChunk: (data: ArrayBuffer) => void): Promise<void> {
    if (!this.nativeModule?.startAudioStream) {
      throw new UnsupportedCapabilityError('SDK', 'audioStream');
    }

    this.audioChunkCallback = onChunk;
    this.isAudioStreaming = true;
    await this.nativeModule.startAudioStream();
    console.info('[SDK] 🎤 Audio streaming started');
  }

  async stopAudioStream(): Promise<void> {
    if (!this.isAudioStreaming) return;
    
    try {
      await this.nativeModule?.stopAudioStream?.();
    } catch { /* ignore */ }

    this.isAudioStreaming = false;
    this.audioChunkCallback = null;
    console.info('[SDK] 🎤 Audio streaming stopped');
  }

  // ─── Display ────────────────────────────────────────────────

  async showOnDisplay(card: DisplayCard): Promise<void> {
    if (!this.nativeModule?.sendNotification) {
      console.info('[SDK] showOnDisplay (offline):', card.title, card.body);
      return;
    }

    try {
      await this.nativeModule.sendNotification({
        title: card.title,
        body: card.body,
        ledPattern: card.ledPattern ?? 'notification',
        speakText: card.speakText,
        durationMs: card.durationMs,
      });
    } catch (e: any) {
      console.warn('[SDK] Display card failed:', e);
    }
  }

  async clearDisplay(): Promise<void> {
    try {
      await this.nativeModule?.clearDisplay?.();
    } catch { /* ignore */ }
  }

  // ─── LED ────────────────────────────────────────────────────

  async setLED(state: LEDState): Promise<void> {
    if (!this.nativeModule?.setLEDState) return;
    
    try {
      const pattern = LED_PATTERNS[state];
      await this.nativeModule.setLEDState(pattern.color, pattern.pattern);
    } catch { /* silent */ }
  }

  // ─── Battery ────────────────────────────────────────────────

  async getBatteryLevel(): Promise<number> {
    if (!this.nativeModule?.getBatteryLevel) {
      return this._info?.batteryLevel ?? -1;
    }

    try {
      const level = await this.nativeModule.getBatteryLevel();
      if (this._info) this._info.batteryLevel = level;
      return level;
    } catch {
      return this._info?.batteryLevel ?? -1;
    }
  }

  // ─── Events ─────────────────────────────────────────────────

  setEventHandlers(handlers: GlassesEventHandlers): void {
    this.handlers = handlers;
  }

  // ─── Native Event Subscriptions ─────────────────────────────

  private subscribeToNativeEvents(): void {
    if (!this.eventEmitter) return;

    this.eventEmitter.addListener('onGlassesConnected', this.handleConnected);
    this.eventEmitter.addListener('onGlassesDisconnected', this.handleDisconnected);
    this.eventEmitter.addListener('onStatusUpdate', this.handleStatusUpdate);
    this.eventEmitter.addListener('onVoiceCommand', this.handleVoiceCommand);
    this.eventEmitter.addListener('onGesture', this.handleGesture);
    this.eventEmitter.addListener('onAudioChunk', this.handleAudioChunk);
    this.eventEmitter.addListener('onMediaCaptured', this.handleMediaCaptured);
    this.eventEmitter.addListener('onBatteryUpdate', this.handleBatteryUpdate);
  }

  private unsubscribeFromNativeEvents(): void {
    if (!this.eventEmitter) return;
    
    const events = [
      'onGlassesConnected', 'onGlassesDisconnected', 'onStatusUpdate',
      'onVoiceCommand', 'onGesture', 'onAudioChunk', 'onMediaCaptured',
      'onBatteryUpdate',
    ];
    events.forEach(e => this.eventEmitter!.removeAllListeners(e));
  }

  // ─── Native Event Handlers ──────────────────────────────────

  private handleConnected = (): void => {
    this._info = {
      name: 'Ray-Ban Meta',
      deviceId: 'sdk-device',
      batteryLevel: -1,
      firmwareVersion: 'unknown',
      isRecording: false,
      signalStrength: 0,
      provider: 'sdk',
    };
    this.setState('connected');
    this.setLED('idle');
    console.info('[SDK] ✅ Glasses connected');
  };

  private handleDisconnected = (): void => {
    this._info = null;
    this.setState('disconnected');
    console.info('[SDK] Glasses disconnected');
  };

  private handleStatusUpdate = (event: any): void => {
    if (this._info) {
      this._info.batteryLevel = event.batteryLevel ?? this._info.batteryLevel;
      this._info.firmwareVersion = event.firmwareVersion ?? this._info.firmwareVersion;
      this._info.isRecording = event.isRecording ?? this._info.isRecording;
      this._info.name = event.deviceName ?? this._info.name;
    }
  };

  private handleVoiceCommand = (event: { commandId: string }): void => {
    console.info('[SDK] Voice command:', event.commandId);
    this.handlers.onVoiceCommand?.(event.commandId);
  };

  private handleGesture = (event: any): void => {
    const gesture: GestureEvent = {
      type: event.type ?? 'tap',
      timestamp: Date.now(),
    };
    this.handlers.onGesture?.(gesture);
  };

  private handleAudioChunk = (event: { data: string }): void => {
    if (this.audioChunkCallback && event.data) {
      const buffer = Buffer.from(event.data, 'base64').buffer;
      this.audioChunkCallback(buffer);
    }
  };

  private handleMediaCaptured = (event: any): void => {
    const asset: MediaAsset = {
      uri: event.uri,
      mimeType: event.mimeType ?? 'image/jpeg',
      width: event.width,
      height: event.height,
      durationMs: event.durationMs,
      sizeBytes: event.sizeBytes ?? 0,
      timestamp: Date.now(),
    };
    this.handlers.onMediaCaptured?.(asset);
  };

  private handleBatteryUpdate = (event: { level: number }): void => {
    if (this._info) this._info.batteryLevel = event.level;
    this.handlers.onBatteryUpdate?.(event.level);
  };

  // ─── Voice Commands Registration ───────────────────────────

  private async registerVoiceCommands(): Promise<void> {
    if (!this.nativeModule?.registerVoiceCommand) return;

    for (const cmd of VOICE_COMMANDS) {
      try {
        await this.nativeModule.registerVoiceCommand(
          cmd.commandId, cmd.phrase, cmd.description,
        );
        console.info(`[SDK] Voice cmd registered: "${cmd.phrase}"`);
      } catch (e) {
        console.warn(`[SDK] Voice cmd failed: "${cmd.phrase}"`, e);
      }
    }
  }

  // ─── Internal ───────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    this._state = state;
    this.handlers.onStateChange?.(state);
  }
}
