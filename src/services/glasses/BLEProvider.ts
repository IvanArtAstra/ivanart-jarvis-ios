/**
 * BLEProvider.ts — Nordic UART implementation of IGlassesProvider
 * Refactored from bleService.ts + BleUartService in metaWearablesService.ts
 * 
 * Capabilities: textCommands, batteryInfo (limited)
 * Everything else throws UnsupportedCapabilityError
 */

import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
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

// Nordic UART Service UUIDs
const NORDIC_UART_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NORDIC_UART_TX      = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // Write (phone → glasses)
const NORDIC_UART_RX      = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // Notify (glasses → phone)

const DEVICE_NAME_PATTERNS = ['ray-ban', 'meta', 'ray ban', 'rayban'];
const SCAN_TIMEOUT_MS = 15000;
const CHUNK_SIZE = 20; // BLE MTU safe default

export class BLEProvider implements IGlassesProvider {
  readonly type = 'ble' as const;
  
  private manager: BleManager | null = null;
  private device: Device | null = null;
  private rxSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private _state: ConnectionState = 'disconnected';
  private handlers: GlassesEventHandlers = {};
  private _info: GlassesInfo | null = null;

  get state(): ConnectionState { return this._state; }
  get info(): GlassesInfo | null { return this._info; }

  get capabilities(): ProviderCapabilities {
    return {
      textCommands: true,
      camera: false,
      video: false,
      audioStream: false,
      display: false,
      gestures: false,
      voiceCommands: false,
      batteryInfo: true, // Limited — parsed from BLE
      led: false,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  async initialize(): Promise<boolean> {
    try {
      this.manager = new BleManager();
      console.info('[BLE] Manager initialized');
      return true;
    } catch (e) {
      console.warn('[BLE] Init failed:', e);
      return false;
    }
  }

  async scan(): Promise<boolean> {
    if (!this.manager) return false;
    
    // Check BLE state
    const bleState = await new Promise<State>((resolve) => {
      const sub = this.manager!.onStateChange((s) => {
        if (s !== State.Unknown) { sub.remove(); resolve(s); }
      }, true);
    });

    if (bleState !== State.PoweredOn) {
      this.setState('error');
      this.handlers.onError?.(new Error(`BLE not ready: ${bleState}. Enable Bluetooth.`));
      return false;
    }

    this.setState('scanning');

    return new Promise((resolve) => {
      let found = false;

      const timeout = setTimeout(() => {
        if (!found) {
          this.manager!.stopDeviceScan();
          this.setState('disconnected');
          console.info('[BLE] Scan timeout — Ray-Ban not found');
          resolve(false);
        }
      }, SCAN_TIMEOUT_MS);

      this.manager!.startDeviceScan(
        null, // Scan ALL (wider net)
        { allowDuplicates: false },
        async (error, device) => {
          if (error) {
            console.warn('[BLE] Scan error:', error);
            clearTimeout(timeout);
            this.setState('error');
            resolve(false);
            return;
          }

          if (found || !device) return;
          const name = (device.name ?? device.localName ?? '').toLowerCase();
          const isRayBan = DEVICE_NAME_PATTERNS.some(p => name.includes(p));

          if (isRayBan) {
            found = true;
            clearTimeout(timeout);
            this.manager!.stopDeviceScan();
            console.info(`[BLE] Found: ${device.name} (${device.id})`);
            
            const connected = await this.connect(device.id);
            resolve(connected);
          }
        },
      );
    });
  }

  async connect(deviceId?: string): Promise<boolean> {
    if (!this.manager || !deviceId) return false;

    this.setState('connecting');

    try {
      const device = await this.manager.connectToDevice(deviceId, {
        requestMTU: 512,
      });
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;

      // Build info
      this._info = {
        name: device.name ?? 'Ray-Ban Meta',
        deviceId: device.id,
        batteryLevel: -1,
        firmwareVersion: 'unknown',
        isRecording: false,
        signalStrength: device.rssi ?? 0,
        provider: 'ble',
      };

      // Subscribe to RX (glasses → phone)
      this.rxSubscription = device.monitorCharacteristicForService(
        NORDIC_UART_SERVICE,
        NORDIC_UART_RX,
        (error, char) => {
          if (error) {
            console.warn('[BLE] RX error:', error.message);
            return;
          }
          if (char?.value) {
            try {
              const decoded = Buffer.from(char.value, 'base64').toString('utf-8');
              this.handlers.onMessage?.(decoded);
            } catch {
              this.handlers.onMessage?.(char.value);
            }
          }
        },
      );

      // Monitor disconnection
      this.disconnectSubscription = this.manager.onDeviceDisconnected(deviceId, () => {
        console.info('[BLE] Device disconnected');
        this.device = null;
        this._info = null;
        this.rxSubscription?.remove();
        this.rxSubscription = null;
        this.setState('disconnected');
      }) as any;

      this.setState('connected');
      console.info(`[BLE] ✅ Connected to: ${device.name}`);
      return true;
    } catch (e: any) {
      console.warn('[BLE] Connection failed:', e);
      this.setState('error');
      this.handlers.onError?.(e);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.rxSubscription?.remove();
    this.rxSubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;

    if (this.device) {
      try { await this.device.cancelConnection(); } catch { /* already disconnected */ }
      this.device = null;
      this._info = null;
    }
    this.setState('disconnected');
  }

  destroy(): void {
    this.disconnect();
    this.manager?.destroy();
    this.manager = null;
  }

  // ─── Text Commands ──────────────────────────────────────────

  async sendText(message: string): Promise<void> {
    if (!this.device) throw new Error('BLE not connected');

    const bytes = Buffer.from(message, 'utf-8');
    
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.slice(i, i + CHUNK_SIZE);
      const b64 = chunk.toString('base64');
      try {
        await this.device.writeCharacteristicWithResponseForService(
          NORDIC_UART_SERVICE, NORDIC_UART_TX, b64,
        );
      } catch {
        await this.device.writeCharacteristicWithoutResponseForService(
          NORDIC_UART_SERVICE, NORDIC_UART_TX, b64,
        );
      }
    }

    // Send newline terminator
    await this.device.writeCharacteristicWithResponseForService(
      NORDIC_UART_SERVICE, NORDIC_UART_TX,
      Buffer.from('\n', 'utf-8').toString('base64'),
    );

    console.info(`[BLE] Sent ${bytes.length} bytes`);
  }

  // ─── Unsupported (SDK-only features) ────────────────────────

  async capturePhoto(): Promise<MediaAsset> {
    throw new UnsupportedCapabilityError('BLE', 'camera');
  }

  async startVideoCapture(): Promise<void> {
    throw new UnsupportedCapabilityError('BLE', 'video');
  }

  async stopVideoCapture(): Promise<MediaAsset> {
    throw new UnsupportedCapabilityError('BLE', 'video');
  }

  async startAudioStream(): Promise<void> {
    throw new UnsupportedCapabilityError('BLE', 'audioStream');
  }

  async stopAudioStream(): Promise<void> {
    throw new UnsupportedCapabilityError('BLE', 'audioStream');
  }

  async showOnDisplay(): Promise<void> {
    throw new UnsupportedCapabilityError('BLE', 'display');
  }

  async clearDisplay(): Promise<void> {
    throw new UnsupportedCapabilityError('BLE', 'display');
  }

  async setLED(): Promise<void> {
    throw new UnsupportedCapabilityError('BLE', 'led');
  }

  async getBatteryLevel(): Promise<number> {
    // BLE battery service (standard 0x180F) — try reading
    if (!this.device) return -1;
    try {
      const char = await this.device.readCharacteristicForService(
        '180F', '2A19',
      );
      if (char?.value) {
        const level = Buffer.from(char.value, 'base64')[0];
        if (this._info) this._info.batteryLevel = level;
        return level;
      }
    } catch { /* Battery service not available */ }
    return this._info?.batteryLevel ?? -1;
  }

  // ─── Events ─────────────────────────────────────────────────

  setEventHandlers(handlers: GlassesEventHandlers): void {
    this.handlers = handlers;
  }

  // ─── Internal ───────────────────────────────────────────────

  private setState(state: ConnectionState): void {
    this._state = state;
    this.handlers.onStateChange?.(state);
  }
}
