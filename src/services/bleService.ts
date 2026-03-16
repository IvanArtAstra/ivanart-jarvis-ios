/**
 * BLE Service v2 — Ray-Ban Meta Smart Glasses via Nordic UART
 * Improved scanning: full 128-bit UUID + name-based fallback
 */

import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import { BLE_SCAN_TIMEOUT_MS, BLE_DEVICE_NAME_FILTER } from '../utils/config';

// Nordic UART Service (NUS) — standard for BLE serial communication
const NORDIC_UART_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NORDIC_UART_TX      = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // Write (phone → device)
const NORDIC_UART_RX      = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // Notify (device → phone)

// Max BLE write size (MTU dependent, safe default)
const MAX_BLE_WRITE_SIZE = 20;

// Device name patterns for Ray-Ban Meta
const DEVICE_NAME_PATTERNS = ['ray-ban', 'meta', 'ray ban', 'rayban'];

export class BLEService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;
  private rxSubscription: Subscription | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  /**
   * Check BLE state (powered on, off, unauthorized, etc.)
   */
  async checkState(): Promise<State> {
    return new Promise((resolve) => {
      const sub = this.manager.onStateChange((state) => {
        if (state !== State.Unknown) {
          sub.remove();
          resolve(state);
        }
      }, true);
    });
  }

  /**
   * Scan for Ray-Ban Meta glasses
   * Strategy: scan by service UUID first, fallback to name-based scan
   */
  async scanForGlasses(
    onFound: (device: Device) => void,
    timeoutMs: number = BLE_SCAN_TIMEOUT_MS,
  ): Promise<void> {
    const state = await this.checkState();
    if (state !== State.PoweredOn) {
      throw new Error(`BLE not ready: ${state}. Enable Bluetooth.`);
    }

    return new Promise((resolve, reject) => {
      let found = false;

      // Scan with Nordic UART UUID filter + null for wider scan
      this.manager.startDeviceScan(
        null, // null = scan ALL devices (wider net for Ray-Ban)
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            console.error('[BLE] Scan error:', error);
            return;
          }
          if (found || !device) return;

          const name = (device.name ?? device.localName ?? '').toLowerCase();
          const matchesName = DEVICE_NAME_PATTERNS.some(p => name.includes(p));
          const matchesFilter = name.includes(BLE_DEVICE_NAME_FILTER);

          if (matchesName || matchesFilter) {
            found = true;
            this.manager.stopDeviceScan();
            console.log(`[BLE] Found: ${device.name} (${device.id})`);
            onFound(device);
            resolve();
          }
        }
      );

      setTimeout(() => {
        if (!found) {
          this.manager.stopDeviceScan();
          reject(new Error(
            'Ray-Ban glasses not found. Make sure they are:\n' +
            '1. Powered on\n' +
            '2. In pairing mode (hold button 5s)\n' +
            '3. Within Bluetooth range'
          ));
        }
      }, timeoutMs);
    });
  }

  /**
   * Connect to device and discover services
   */
  async connect(deviceId: string): Promise<Device> {
    console.log(`[BLE] Connecting to ${deviceId}...`);
    const device = await this.manager.connectToDevice(deviceId, {
      requestMTU: 512, // Request larger MTU for faster transfers
    });
    await device.discoverAllServicesAndCharacteristics();
    this.connectedDevice = device;

    // Log discovered services
    const services = await device.services();
    console.log('[BLE] Services:', services.map(s => s.uuid).join(', '));

    // Monitor disconnection
    this.manager.onDeviceDisconnected(deviceId, (error, dev) => {
      console.log(`[BLE] Device disconnected: ${dev?.name ?? deviceId}`);
      this.connectedDevice = null;
      this.rxSubscription?.remove();
      this.rxSubscription = null;
    });

    console.log(`[BLE] ✅ Connected to: ${device.name}`);
    return device;
  }

  /**
   * Send text to glasses via Nordic UART TX
   * Chunks data if exceeding BLE write size
   */
  async sendToGlasses(text: string): Promise<void> {
    if (!this.connectedDevice) throw new Error('Not connected to glasses');

    // Encode to base64 and chunk
    const fullData = Buffer.from(text, 'utf-8').toString('base64');

    // Write in chunks
    for (let i = 0; i < fullData.length; i += MAX_BLE_WRITE_SIZE) {
      const chunk = fullData.slice(i, i + MAX_BLE_WRITE_SIZE);
      try {
        await this.connectedDevice.writeCharacteristicWithResponseForService(
          NORDIC_UART_SERVICE,
          NORDIC_UART_TX,
          chunk,
        );
      } catch (e) {
        // Fallback: try without response (faster but less reliable)
        await this.connectedDevice.writeCharacteristicWithoutResponseForService(
          NORDIC_UART_SERVICE,
          NORDIC_UART_TX,
          chunk,
        );
      }
    }
    console.log(`[BLE] Sent ${text.length} chars to glasses`);
  }

  /**
   * Subscribe to incoming data from glasses (RX characteristic)
   */
  subscribeToAudio(callback: (data: string) => void): Subscription | null {
    if (!this.connectedDevice) {
      console.error('[BLE] Cannot subscribe: not connected');
      return null;
    }

    this.rxSubscription = this.connectedDevice.monitorCharacteristicForService(
      NORDIC_UART_SERVICE,
      NORDIC_UART_RX,
      (error, char) => {
        if (error) {
          console.error('[BLE] RX error:', error.message);
          return;
        }
        if (char?.value) {
          try {
            const decoded = Buffer.from(char.value, 'base64').toString('utf-8');
            callback(decoded);
          } catch {
            callback(char.value);
          }
        }
      },
    );
    return this.rxSubscription;
  }

  /**
   * Disconnect from glasses
   */
  async disconnect(): Promise<void> {
    this.rxSubscription?.remove();
    this.rxSubscription = null;
    if (this.connectedDevice) {
      try {
        await this.connectedDevice.cancelConnection();
      } catch {
        // Already disconnected
      }
      this.connectedDevice = null;
      console.log('[BLE] Disconnected');
    }
  }

  isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  getDeviceName(): string | null {
    return this.connectedDevice?.name ?? null;
  }
}

export const bleService = new BLEService();
