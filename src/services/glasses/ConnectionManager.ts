/**
 * ConnectionManager.ts — Smart router between BLE and Meta SDK providers
 * 
 * Modes:
 *   - 'ble'  — Force BLE UART only
 *   - 'sdk'  — Force Meta SDK only
 *   - 'auto' — Try SDK first, fallback to BLE, auto-switch on failure
 * 
 * Routes each action to the best available provider based on capabilities.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  IGlassesProvider,
  ConnectionMode,
  ConnectionState,
  GlassesInfo,
  MediaAsset,
  DisplayCard,
  LEDState,
  GlassesEventHandlers,
  ProviderCapabilities,
  UnsupportedCapabilityError,
} from './GlassesProvider';
import { BLEProvider } from './BLEProvider';
import { MetaSDKProvider } from './MetaSDKProvider';

const STORAGE_KEY_MODE = '@jarvis/connection_mode';

// Actions that require SDK
type SDKAction = 'camera' | 'video' | 'audio' | 'display' | 'gesture' | 'voiceCommand' | 'led';
// Actions that work on both
type SharedAction = 'text' | 'battery';

export interface ConnectionStatus {
  mode: ConnectionMode;
  bleState: ConnectionState;
  sdkState: ConnectionState;
  activeProvider: 'ble' | 'sdk' | 'none';
  bleInfo: GlassesInfo | null;
  sdkInfo: GlassesInfo | null;
  bleCapabilities: ProviderCapabilities;
  sdkCapabilities: ProviderCapabilities;
}

export class ConnectionManager {
  private ble: BLEProvider;
  private sdk: MetaSDKProvider;
  private _mode: ConnectionMode = 'auto';
  private handlers: GlassesEventHandlers = {};
  private bleInitialized = false;
  private sdkInitialized = false;

  // External status listener
  private statusListener?: (status: ConnectionStatus) => void;

  constructor() {
    this.ble = new BLEProvider();
    this.sdk = new MetaSDKProvider();
  }

  get mode(): ConnectionMode { return this._mode; }

  // ─── Initialize ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Load saved mode
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY_MODE);
      if (saved && ['ble', 'sdk', 'auto'].includes(saved)) {
        this._mode = saved as ConnectionMode;
      }
    } catch { /* default auto */ }

    // Initialize providers based on mode
    if (this._mode === 'ble' || this._mode === 'auto') {
      this.bleInitialized = await this.ble.initialize();
    }

    if (this._mode === 'sdk' || this._mode === 'auto') {
      this.sdkInitialized = await this.sdk.initialize();
    }

    // Set up event forwarding
    this.setupEventForwarding();

    console.info(`[ConnectionManager] Mode: ${this._mode}, BLE: ${this.bleInitialized}, SDK: ${this.sdkInitialized}`);
  }

  // ─── Mode Switching ─────────────────────────────────────────

  async setMode(mode: ConnectionMode): Promise<void> {
    if (mode === this._mode) return;

    console.info(`[ConnectionManager] Switching mode: ${this._mode} → ${mode}`);

    // Disconnect current providers
    if (this.ble.state === 'connected') await this.ble.disconnect();
    if (this.sdk.state === 'connected') await this.sdk.disconnect();

    this._mode = mode;
    await AsyncStorage.setItem(STORAGE_KEY_MODE, mode);

    // Initialize newly needed providers
    if ((mode === 'ble' || mode === 'auto') && !this.bleInitialized) {
      this.bleInitialized = await this.ble.initialize();
    }
    if ((mode === 'sdk' || mode === 'auto') && !this.sdkInitialized) {
      this.sdkInitialized = await this.sdk.initialize();
    }

    this.notifyStatusChange();
  }

  // ─── Connect / Scan ─────────────────────────────────────────

  async scanAndConnect(): Promise<boolean> {
    switch (this._mode) {
      case 'sdk':
        return this.connectSDK();
      
      case 'ble':
        return this.connectBLE();
      
      case 'auto':
      default:
        // Try SDK first (better capabilities)
        if (this.sdkInitialized) {
          const sdkOk = await this.connectSDK();
          if (sdkOk) return true;
        }
        // Fallback to BLE
        if (this.bleInitialized) {
          return this.connectBLE();
        }
        return false;
    }
  }

  private async connectSDK(): Promise<boolean> {
    try {
      const scanned = await this.sdk.scan();
      if (scanned) {
        this.notifyStatusChange();
        return true;
      }
      // Try connecting to last device directly
      const connected = await this.sdk.connect();
      this.notifyStatusChange();
      return connected;
    } catch (e) {
      console.warn('[ConnectionManager] SDK connect failed:', e);
      return false;
    }
  }

  private async connectBLE(): Promise<boolean> {
    try {
      const connected = await this.ble.scan();
      this.notifyStatusChange();
      return connected;
    } catch (e) {
      console.warn('[ConnectionManager] BLE connect failed:', e);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.ble.state === 'connected') await this.ble.disconnect();
    if (this.sdk.state === 'connected') await this.sdk.disconnect();
    this.notifyStatusChange();
  }

  // ─── Smart Routing ──────────────────────────────────────────

  /**
   * Get the best provider for a given action.
   * SDK-only actions always go to SDK (or throw if unavailable).
   * Shared actions go to the best connected provider.
   */
  private getProviderFor(action: SDKAction | SharedAction): IGlassesProvider {
    const sdkActions: SDKAction[] = ['camera', 'video', 'audio', 'display', 'gesture', 'voiceCommand', 'led'];
    
    if (sdkActions.includes(action as SDKAction)) {
      // SDK-only action
      if (this.sdk.state === 'connected') return this.sdk;
      throw new UnsupportedCapabilityError(
        this._mode === 'ble' ? 'BLE' : 'current',
        `${action} (requires SDK connection)`,
      );
    }

    // Shared action — prefer based on mode
    if (this._mode === 'sdk' && this.sdk.state === 'connected') return this.sdk;
    if (this._mode === 'ble' && this.ble.state === 'connected') return this.ble;

    // Auto: prefer SDK (richer), fallback BLE
    if (this.sdk.state === 'connected') return this.sdk;
    if (this.ble.state === 'connected') return this.ble;

    throw new Error(`No provider connected for action: ${action}`);
  }

  // ─── Public API (delegates to provider) ─────────────────────

  async sendText(message: string): Promise<void> {
    const provider = this.getProviderFor('text');
    await provider.sendText(message);
  }

  async capturePhoto(): Promise<MediaAsset> {
    const provider = this.getProviderFor('camera');
    return provider.capturePhoto();
  }

  async startVideoCapture(): Promise<void> {
    const provider = this.getProviderFor('video');
    await provider.startVideoCapture();
  }

  async stopVideoCapture(): Promise<MediaAsset> {
    const provider = this.getProviderFor('video');
    return provider.stopVideoCapture();
  }

  async startAudioStream(onChunk: (data: ArrayBuffer) => void): Promise<void> {
    const provider = this.getProviderFor('audio');
    await provider.startAudioStream(onChunk);
  }

  async stopAudioStream(): Promise<void> {
    const provider = this.getProviderFor('audio');
    await provider.stopAudioStream();
  }

  async showOnDisplay(card: DisplayCard): Promise<void> {
    const provider = this.getProviderFor('display');
    await provider.showOnDisplay(card);
  }

  async clearDisplay(): Promise<void> {
    const provider = this.getProviderFor('display');
    await provider.clearDisplay();
  }

  async setLED(state: LEDState): Promise<void> {
    const provider = this.getProviderFor('led');
    await provider.setLED(state);
  }

  async getBatteryLevel(): Promise<number> {
    const provider = this.getProviderFor('battery');
    return provider.getBatteryLevel();
  }

  // ─── Status ─────────────────────────────────────────────────

  getStatus(): ConnectionStatus {
    const sdkConnected = this.sdk.state === 'connected';
    const bleConnected = this.ble.state === 'connected';

    let activeProvider: 'ble' | 'sdk' | 'none' = 'none';
    if (this._mode === 'sdk' && sdkConnected) activeProvider = 'sdk';
    else if (this._mode === 'ble' && bleConnected) activeProvider = 'ble';
    else if (this._mode === 'auto') {
      activeProvider = sdkConnected ? 'sdk' : (bleConnected ? 'ble' : 'none');
    }

    return {
      mode: this._mode,
      bleState: this.ble.state,
      sdkState: this.sdk.state,
      activeProvider,
      bleInfo: this.ble.info,
      sdkInfo: this.sdk.info,
      bleCapabilities: this.ble.capabilities,
      sdkCapabilities: this.sdk.capabilities,
    };
  }

  get isConnected(): boolean {
    if (this._mode === 'ble') return this.ble.state === 'connected';
    if (this._mode === 'sdk') return this.sdk.state === 'connected';
    return this.ble.state === 'connected' || this.sdk.state === 'connected';
  }

  get activeProvider(): 'ble' | 'sdk' | 'none' {
    return this.getStatus().activeProvider;
  }

  get activeInfo(): GlassesInfo | null {
    const ap = this.activeProvider;
    if (ap === 'sdk') return this.sdk.info;
    if (ap === 'ble') return this.ble.info;
    return null;
  }

  // ─── Events ─────────────────────────────────────────────────

  setEventHandlers(handlers: GlassesEventHandlers): void {
    this.handlers = handlers;
    this.setupEventForwarding();
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): void {
    this.statusListener = listener;
  }

  // ─── Event Forwarding ───────────────────────────────────────

  private setupEventForwarding(): void {
    const forwardHandlers: GlassesEventHandlers = {
      onStateChange: (state) => {
        this.handlers.onStateChange?.(state);
        this.notifyStatusChange();
      },
      onMessage: (text) => this.handlers.onMessage?.(text),
      onGesture: (gesture) => this.handlers.onGesture?.(gesture),
      onVoiceCommand: (cmd) => this.handlers.onVoiceCommand?.(cmd),
      onMediaCaptured: (asset) => this.handlers.onMediaCaptured?.(asset),
      onBatteryUpdate: (level) => this.handlers.onBatteryUpdate?.(level),
      onError: (error) => this.handlers.onError?.(error),
    };

    this.ble.setEventHandlers(forwardHandlers);
    this.sdk.setEventHandlers(forwardHandlers);
  }

  private notifyStatusChange(): void {
    this.statusListener?.(this.getStatus());
  }

  // ─── Cleanup ────────────────────────────────────────────────

  destroy(): void {
    this.ble.destroy();
    this.sdk.destroy();
  }
}

// Singleton
export const connectionManager = new ConnectionManager();
