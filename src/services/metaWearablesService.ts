/**
 * metaWearablesService.ts
 * Официальная интеграция с Meta Wearables SDK + BLE UART fallback
 *
 * App ID: 1261497052067859
 * Docs:   https://wearables.developer.meta.com
 *
 * Режимы:
 * 1. Meta SDK (нативный модуль) — если установлен
 * 2. BLE UART fallback — Nordic UART Service для Ray-Ban Meta без SDK
 *
 * BLE UART (Nordic UART Service):
 *   Service UUID: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   TX Char:      6E400002-B5A3-F393-E0A9-E50E24DCCA9E  (write → glasses)
 *   RX Char:      6E400003-B5A3-F393-E0A9-E50E24DCCA9E  (notify ← glasses)
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// ─── BLE UART Support ─────────────────────────────────────────────────────────
// react-native-ble-plx must be installed: npm install react-native-ble-plx
let BleManager: any = null;
try {
  BleManager = require('react-native-ble-plx').BleManager;
} catch {
  console.info('[MetaWearables] react-native-ble-plx not installed — BLE UART disabled');
}

// Nordic UART Service UUIDs
const NORDIC_UART_SERVICE  = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NORDIC_UART_TX       = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // write (phone → glasses)
const NORDIC_UART_RX       = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // notify (glasses → phone)

const RAYBAN_DEVICE_NAMES  = ['ray-ban meta', 'meta', 'ray-ban'];

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface GlassesStatus {
  connected: boolean;
  batteryLevel: number;        // 0-100
  firmwareVersion: string;
  deviceName: string;
  isRecording: boolean;
  ledState: LEDState;
  mode: 'sdk' | 'ble' | 'offline';
}

export type LEDState = 'off' | 'idle' | 'recording' | 'thinking' | 'notification' | 'error';

export interface MetaVoiceCommand {
  commandId: string;
  phrase: string;
  description: string;
}

export interface MetaNotification {
  title: string;
  body: string;
  ledPattern?: LEDState;
  speakText?: string;
}

// ─── LED паттерны Jarvis ──────────────────────────────────────────────────────

export const LED_PATTERNS: Record<LEDState, { color: string; pattern: string }> = {
  off:          { color: 'none',   pattern: 'off' },
  idle:         { color: 'white',  pattern: 'breathe_slow' },
  recording:    { color: 'red',    pattern: 'solid' },
  thinking:     { color: 'blue',   pattern: 'pulse_fast' },
  notification: { color: 'green',  pattern: 'blink_3x' },
  error:        { color: 'red',    pattern: 'blink_fast' },
};

export const JARVIS_VOICE_COMMANDS: MetaVoiceCommand[] = [
  {
    commandId: 'jarvis_status',
    phrase: 'Джарвис, что сегодня',
    description: 'Получить статус системы агентов',
  },
  {
    commandId: 'jarvis_tasks',
    phrase: 'Джарвис, задачи',
    description: 'Сколько задач в очереди',
  },
  {
    commandId: 'jarvis_listen',
    phrase: 'Джарвис',
    description: 'Активировать Jarvis для голосового запроса',
  },
  {
    commandId: 'jarvis_stop',
    phrase: 'Стоп Джарвис',
    description: 'Остановить текущую операцию',
  },
];

// ─── BLE UART Service ─────────────────────────────────────────────────────────

class BleUartService {
  private manager: any = null;
  private device: any = null;
  private rxSubscription: any = null;
  private isScanning = false;

  private onConnectedCb?: () => void;
  private onDisconnectedCb?: () => void;
  private onDataCb?: (text: string) => void;

  init(): boolean {
    if (!BleManager) return false;
    try {
      this.manager = new BleManager();
      console.info('[BLE-UART] Manager initialized');
      return true;
    } catch (e) {
      console.warn('[BLE-UART] Init failed:', e);
      return false;
    }
  }

  get isConnected(): boolean {
    return this.device !== null;
  }

  /**
   * Сканировать и подключиться к Ray-Ban Meta
   */
  async scanAndConnect(): Promise<boolean> {
    if (!this.manager) return false;
    if (this.isScanning) return false;

    this.isScanning = true;
    console.info('[BLE-UART] Scanning for Ray-Ban Meta...');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.manager.stopDeviceScan();
        this.isScanning = false;
        console.info('[BLE-UART] Scan timeout — Ray-Ban not found');
        resolve(false);
      }, 15000);

      this.manager.startDeviceScan(
        null, // scan all services (filter by name below)
        { allowDuplicates: false },
        async (error: any, device: any) => {
          if (error) {
            console.warn('[BLE-UART] Scan error:', error);
            clearTimeout(timeout);
            this.isScanning = false;
            resolve(false);
            return;
          }

          if (!device?.name) return;
          const nameLower = device.name.toLowerCase();
          const isRayBan = RAYBAN_DEVICE_NAMES.some(n => nameLower.includes(n));
          if (!isRayBan) return;

          console.info(`[BLE-UART] Found: ${device.name} (${device.id})`);
          this.manager.stopDeviceScan();
          clearTimeout(timeout);
          this.isScanning = false;

          const connected = await this.connectToDevice(device);
          resolve(connected);
        },
      );
    });
  }

  private async connectToDevice(device: any): Promise<boolean> {
    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      this.device = connected;

      // Subscribe to RX notifications (glasses → phone)
      this.rxSubscription = this.device.monitorCharacteristicForService(
        NORDIC_UART_SERVICE,
        NORDIC_UART_RX,
        (error: any, characteristic: any) => {
          if (error) {
            console.warn('[BLE-UART] RX error:', error);
            return;
          }
          if (characteristic?.value) {
            const text = Buffer.from(characteristic.value, 'base64').toString('utf8');
            console.info('[BLE-UART] RX:', text);
            this.onDataCb?.(text);
          }
        },
      );

      // Listen for disconnection
      this.device.onDisconnected(() => {
        console.info('[BLE-UART] Ray-Ban disconnected');
        this.device = null;
        this.rxSubscription = null;
        this.onDisconnectedCb?.();
      });

      console.info('[BLE-UART] ✅ Connected to Ray-Ban Meta');
      this.onConnectedCb?.();
      return true;

    } catch (e) {
      console.warn('[BLE-UART] Connection failed:', e);
      this.device = null;
      return false;
    }
  }

  /**
   * Отправить текст в очки через BLE TX
   * Разбивает длинный текст на чанки по 20 байт (BLE MTU)
   */
  async sendText(text: string): Promise<void> {
    if (!this.device || !this.manager) {
      console.warn('[BLE-UART] Not connected — cannot send');
      return;
    }

    try {
      const encoded = Buffer.from(text, 'utf8').toString('base64');

      // BLE UART передаёт до 20 байт за раз — разбиваем на чанки
      const CHUNK_SIZE = 20;
      const bytes = Buffer.from(text, 'utf8');
      const chunks: Buffer[] = [];

      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        chunks.push(bytes.slice(i, i + CHUNK_SIZE));
      }

      for (const chunk of chunks) {
        await this.device.writeCharacteristicWithResponseForService(
          NORDIC_UART_SERVICE,
          NORDIC_UART_TX,
          chunk.toString('base64'),
        );
      }

      // Send newline as terminator
      await this.device.writeCharacteristicWithResponseForService(
        NORDIC_UART_SERVICE,
        NORDIC_UART_TX,
        Buffer.from('\n', 'utf8').toString('base64'),
      );

      console.info(`[BLE-UART] Sent ${bytes.length} bytes to Ray-Ban`);

    } catch (e) {
      console.warn('[BLE-UART] Send failed:', e);
    }
  }

  disconnect(): void {
    this.rxSubscription?.remove();
    this.device?.cancelConnection();
    this.device = null;
    this.rxSubscription = null;
  }

  destroy(): void {
    this.disconnect();
    this.manager?.destroy();
    this.manager = null;
  }

  onConnected(cb: () => void) { this.onConnectedCb = cb; }
  onDisconnected(cb: () => void) { this.onDisconnectedCb = cb; }
  onData(cb: (text: string) => void) { this.onDataCb = cb; }
}

// ─── Main MetaWearables Service ───────────────────────────────────────────────

class MetaWearablesService {
  private isInitialized = false;
  private glassesStatus: GlassesStatus | null = null;
  private eventEmitter: NativeEventEmitter | null = null;
  private bleUart = new BleUartService();
  private mode: 'sdk' | 'ble' | 'offline' = 'offline';

  private onVoiceCommandCallback?: (commandId: string) => void;
  private onStatusChangeCallback?: (status: GlassesStatus) => void;
  private onConnectedCallback?: () => void;
  private onDisconnectedCallback?: () => void;
  private onBleMessageCallback?: (text: string) => void;

  readonly APP_ID = '1261497052067859';
  readonly CLIENT_TOKEN = 'AR|1261497052067859|02adee6bcb50f0e9f0468b6708550e7d';

  /**
   * Инициализация: сначала пробует Meta SDK, затем BLE UART
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (Platform.OS !== 'ios') return false;

    // Try Meta SDK first
    const sdkOk = await this.initMetaSDK();
    if (sdkOk) {
      this.mode = 'sdk';
      this.isInitialized = true;
      console.info('[MetaWearables] Mode: Meta SDK ✓');
      return true;
    }

    // Fallback to BLE UART
    const bleOk = this.bleUart.init();
    if (bleOk) {
      this.mode = 'ble';
      this.bleUart.onConnected(() => {
        console.info('[MetaWearables] BLE connected');
        this.glassesStatus = {
          connected: true,
          batteryLevel: -1,
          firmwareVersion: 'unknown',
          deviceName: 'Ray-Ban Meta',
          isRecording: false,
          ledState: 'idle',
          mode: 'ble',
        };
        this.onConnectedCallback?.();
        this.onStatusChangeCallback?.(this.glassesStatus);
      });
      this.bleUart.onDisconnected(() => {
        this.glassesStatus = null;
        this.onDisconnectedCallback?.();
      });
      this.bleUart.onData((text) => {
        this.onBleMessageCallback?.(text);
      });
      this.isInitialized = true;
      console.info('[MetaWearables] Mode: BLE UART ✓');
      return true;
    }

    this.mode = 'offline';
    console.warn('[MetaWearables] No SDK or BLE available');
    return false;
  }

  private async initMetaSDK(): Promise<boolean> {
    try {
      const { MetaWearables } = NativeModules;
      if (!MetaWearables) return false;

      await MetaWearables.initialize(this.APP_ID, this.CLIENT_TOKEN);

      this.eventEmitter = new NativeEventEmitter(MetaWearables);
      this.eventEmitter.addListener('onGlassesConnected', this.handleConnected.bind(this));
      this.eventEmitter.addListener('onGlassesDisconnected', this.handleDisconnected.bind(this));
      this.eventEmitter.addListener('onStatusUpdate', this.handleStatusUpdate.bind(this));
      this.eventEmitter.addListener('onVoiceCommand', this.handleVoiceCommand.bind(this));

      await this.registerVoiceCommands();
      console.info('[MetaWearables] SDK инициализирован ✓');
      return true;
    } catch (error) {
      console.warn('[MetaWearables] SDK init failed:', error);
      return false;
    }
  }

  /**
   * Запустить BLE UART сканирование для Ray-Ban (без Meta SDK)
   */
  async scanForRayBan(): Promise<boolean> {
    if (this.mode !== 'ble') {
      console.warn('[MetaWearables] BLE mode not active');
      return false;
    }
    return this.bleUart.scanAndConnect();
  }

  /**
   * Отправить текст на очки (SDK или BLE)
   * Вызывать когда Jarvis отвечает — текст покажется/озвучится на очках
   */
  async sendToGlasses(text: string): Promise<void> {
    if (this.mode === 'sdk') {
      await this.sendNotification({
        title: 'Jarvis',
        body: text,
        ledPattern: 'notification',
        speakText: text,
      });
    } else if (this.mode === 'ble' && this.bleUart.isConnected) {
      await this.bleUart.sendText(text);
    } else {
      console.info('[MetaWearables] sendToGlasses: not connected (mode:', this.mode, ')');
    }
  }

  private async registerVoiceCommands(): Promise<void> {
    const { MetaWearables } = NativeModules;
    if (!MetaWearables?.registerVoiceCommand) return;

    for (const cmd of JARVIS_VOICE_COMMANDS) {
      try {
        await MetaWearables.registerVoiceCommand(
          cmd.commandId, cmd.phrase, cmd.description,
        );
        console.info(`[MetaWearables] Команда: "${cmd.phrase}"`);
      } catch (e) {
        console.warn(`[MetaWearables] Команда failed: "${cmd.phrase}"`, e);
      }
    }
  }

  async sendNotification(notification: MetaNotification): Promise<void> {
    const { MetaWearables } = NativeModules;
    if (!MetaWearables?.sendNotification) {
      console.info('[MetaWearables] sendNotification (SDK offline):', notification.title);
      return;
    }
    try {
      await MetaWearables.sendNotification({
        title: notification.title,
        body: notification.body,
        ledPattern: notification.ledPattern ?? 'notification',
        speakText: notification.speakText,
      });
    } catch (e) {
      console.warn('[MetaWearables] Notification failed:', e);
    }
  }

  async setLED(state: LEDState): Promise<void> {
    const { MetaWearables } = NativeModules;
    if (!MetaWearables?.setLEDState) return;
    try {
      const pattern = LED_PATTERNS[state];
      await MetaWearables.setLEDState(pattern.color, pattern.pattern);
    } catch { /* silent */ }
  }

  async getStatus(): Promise<GlassesStatus | null> {
    const { MetaWearables } = NativeModules;
    if (!MetaWearables?.getGlassesStatus) return this.glassesStatus;
    try {
      const status = await MetaWearables.getGlassesStatus();
      this.glassesStatus = { ...status, mode: 'sdk' };
      return this.glassesStatus;
    } catch {
      return this.glassesStatus;
    }
  }

  // ─── Event handlers ──────────────────────────────────────

  private handleConnected(): void {
    console.info('[MetaWearables] SDK: Очки подключены ✓');
    this.onConnectedCallback?.();
    this.setLED('idle');
  }

  private handleDisconnected(): void {
    console.info('[MetaWearables] SDK: Очки отключены');
    this.glassesStatus = null;
    this.onDisconnectedCallback?.();
  }

  private handleStatusUpdate(status: GlassesStatus): void {
    this.glassesStatus = { ...status, mode: 'sdk' };
    this.onStatusChangeCallback?.(this.glassesStatus);
  }

  private handleVoiceCommand(event: { commandId: string }): void {
    console.info('[MetaWearables] Голосовая команда:', event.commandId);
    this.onVoiceCommandCallback?.(event.commandId);
  }

  // ─── Callbacks ───────────────────────────────────────────

  onVoiceCommand(cb: (commandId: string) => void) { this.onVoiceCommandCallback = cb; }
  onStatusChange(cb: (status: GlassesStatus) => void) { this.onStatusChangeCallback = cb; }
  onConnected(cb: () => void) { this.onConnectedCallback = cb; }
  onDisconnected(cb: () => void) { this.onDisconnectedCallback = cb; }
  /** BLE UART — входящие данные от очков (без Meta SDK) */
  onBleMessage(cb: (text: string) => void) { this.onBleMessageCallback = cb; }

  // ─── State ───────────────────────────────────────────────

  get isReady(): boolean { return this.isInitialized; }
  get currentStatus(): GlassesStatus | null { return this.glassesStatus; }
  get currentMode(): 'sdk' | 'ble' | 'offline' { return this.mode; }
  get bleConnected(): boolean { return this.bleUart.isConnected; }

  destroy(): void {
    this.eventEmitter?.removeAllListeners('onGlassesConnected');
    this.eventEmitter?.removeAllListeners('onGlassesDisconnected');
    this.eventEmitter?.removeAllListeners('onStatusUpdate');
    this.eventEmitter?.removeAllListeners('onVoiceCommand');
    this.bleUart.destroy();
    this.isInitialized = false;
  }
}

export const metaWearablesService = new MetaWearablesService();
