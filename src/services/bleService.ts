/**
 * BLE Service — подключение к Meta Ray-Ban Smart Glasses
 * Протокол: reverse-engineered Meta BLE UUID
 */

import { BleManager, Device, State } from 'react-native-ble-plx';

// Meta Ray-Ban BLE Service UUIDs (известные из reverse engineering)
const META_RAYBAN_SERVICE_UUID = 'FE59'; // Nordic UART Service
const META_RAYBAN_TX_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // Write
const META_RAYBAN_RX_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // Notify

export class BLEService {
  private manager: BleManager;
  private connectedDevice: Device | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  /**
   * Проверить состояние BLE
   */
  async checkState(): Promise<State> {
    return new Promise((resolve) => {
      this.manager.onStateChange((state) => {
        if (state !== State.Unknown) resolve(state);
      }, true);
    });
  }

  /**
   * Сканировать и найти Ray-Ban очки
   */
  async scanForGlasses(
    onFound: (device: Device) => void,
    timeoutMs: number = 10000
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.manager.startDeviceScan(
        [META_RAYBAN_SERVICE_UUID],
        { allowDuplicates: false },
        (error, device) => {
          if (error) {
            reject(error);
            return;
          }
          if (device && device.name?.toLowerCase().includes('ray-ban')) {
            this.manager.stopDeviceScan();
            onFound(device);
            resolve();
          }
        }
      );

      // Таймаут сканирования
      setTimeout(() => {
        this.manager.stopDeviceScan();
        reject(new Error('Ray-Ban glasses not found'));
      }, timeoutMs);
    });
  }

  /**
   * Подключиться к очкам
   */
  async connect(deviceId: string): Promise<Device> {
    const device = await this.manager.connectToDevice(deviceId);
    await device.discoverAllServicesAndCharacteristics();
    this.connectedDevice = device;
    console.log('[BLE] Connected to:', device.name);
    return device;
  }

  /**
   * Отправить команду на очки (текст → TTS через динамики)
   */
  async sendToGlasses(text: string): Promise<void> {
    if (!this.connectedDevice) throw new Error('Not connected');
    
    const encoded = Buffer.from(text).toString('base64');
    await this.connectedDevice.writeCharacteristicWithResponseForService(
      META_RAYBAN_SERVICE_UUID,
      META_RAYBAN_TX_UUID,
      encoded
    );
  }

  /**
   * Подписаться на входящий звук (mic с очков)
   */
  subscribeToAudio(callback: (data: string) => void) {
    if (!this.connectedDevice) throw new Error('Not connected');
    
    return this.connectedDevice.monitorCharacteristicForService(
      META_RAYBAN_SERVICE_UUID,
      META_RAYBAN_RX_UUID,
      (error, char) => {
        if (error) {
          console.error('[BLE] Monitor error:', error);
          return;
        }
        if (char?.value) {
          const decoded = Buffer.from(char.value, 'base64').toString();
          callback(decoded);
        }
      }
    );
  }

  /**
   * Отключиться
   */
  async disconnect(): Promise<void> {
    if (this.connectedDevice) {
      await this.connectedDevice.cancelConnection();
      this.connectedDevice = null;
      console.log('[BLE] Disconnected');
    }
  }

  isConnected(): boolean {
    return this.connectedDevice !== null;
  }
}

export const bleService = new BLEService();
