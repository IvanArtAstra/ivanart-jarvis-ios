/**
 * metaWearablesService.ts
 * Официальная интеграция с Meta Wearables SDK (Ray-Ban Meta Smart Glasses)
 *
 * App ID: 1261497052067859
 * Docs:   https://wearables.developer.meta.com
 *
 * Возможности официального SDK:
 * - Голосовые команды через "Hey Meta" (регистрация кастомных команд)
 * - LED уведомления
 * - Нативные push-уведомления на очки
 * - Доступ к камере
 * - Статус очков (заряд, подключение)
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface GlassesStatus {
  connected: boolean;
  batteryLevel: number;        // 0-100
  firmwareVersion: string;
  deviceName: string;
  isRecording: boolean;
  ledState: LEDState;
}

export type LEDState = 'off' | 'idle' | 'recording' | 'thinking' | 'notification' | 'error';

export interface MetaVoiceCommand {
  commandId: string;
  phrase: string;             // фраза которую скажет пользователь
  description: string;
}

export interface MetaNotification {
  title: string;
  body: string;
  ledPattern?: LEDState;
  speakText?: string;         // произнести голосом через очки
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

// ─── Голосовые команды для регистрации ───────────────────────────────────────

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

// ─── Сервис ───────────────────────────────────────────────────────────────────

class MetaWearablesService {
  private isInitialized = false;
  private glassesStatus: GlassesStatus | null = null;
  private eventEmitter: NativeEventEmitter | null = null;

  // Колбэки
  private onVoiceCommandCallback?: (commandId: string) => void;
  private onStatusChangeCallback?: (status: GlassesStatus) => void;
  private onConnectedCallback?: () => void;
  private onDisconnectedCallback?: () => void;

  readonly APP_ID = '1261497052067859';
  readonly CLIENT_TOKEN = 'AR|1261497052067859|02adee6bcb50f0e9f0468b6708550e7d';

  /**
   * Инициализация SDK
   * Вызывать один раз при старте приложения
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (Platform.OS !== 'ios') return false;

    try {
      // Проверить доступность нативного модуля
      const { MetaWearables } = NativeModules;

      if (!MetaWearables) {
        console.warn('[MetaWearables] Нативный модуль не найден. SDK не установлен?');
        console.info('[MetaWearables] Fallback на BLE UART режим');
        return false;
      }

      // Инициализировать с App ID
      await MetaWearables.initialize(this.APP_ID, this.CLIENT_TOKEN);

      // Подписаться на события
      this.eventEmitter = new NativeEventEmitter(MetaWearables);

      this.eventEmitter.addListener('onGlassesConnected', this.handleConnected.bind(this));
      this.eventEmitter.addListener('onGlassesDisconnected', this.handleDisconnected.bind(this));
      this.eventEmitter.addListener('onStatusUpdate', this.handleStatusUpdate.bind(this));
      this.eventEmitter.addListener('onVoiceCommand', this.handleVoiceCommand.bind(this));

      // Зарегистрировать кастомные голосовые команды Jarvis
      await this.registerVoiceCommands();

      this.isInitialized = true;
      console.info('[MetaWearables] SDK инициализирован ✓');
      return true;

    } catch (error) {
      console.warn('[MetaWearables] Ошибка инициализации:', error);
      return false;
    }
  }

  /**
   * Зарегистрировать голосовые команды "Hey Meta → Jarvis"
   */
  private async registerVoiceCommands(): Promise<void> {
    const { MetaWearables } = NativeModules;
    if (!MetaWearables?.registerVoiceCommand) return;

    for (const cmd of JARVIS_VOICE_COMMANDS) {
      try {
        await MetaWearables.registerVoiceCommand(
          cmd.commandId,
          cmd.phrase,
          cmd.description,
        );
        console.info(`[MetaWearables] Команда зарегистрирована: "${cmd.phrase}"`);
      } catch (e) {
        console.warn(`[MetaWearables] Не удалось зарегистрировать "${cmd.phrase}":`, e);
      }
    }
  }

  /**
   * Отправить уведомление на очки
   * LED мигнёт + текст произнесётся через динамики
   */
  async sendNotification(notification: MetaNotification): Promise<void> {
    const { MetaWearables } = NativeModules;

    if (!MetaWearables?.sendNotification) {
      // Fallback — логируем (BLE сервис отправит отдельно)
      console.info('[MetaWearables] sendNotification (SDK недоступен):', notification.title);
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
      console.warn('[MetaWearables] Ошибка уведомления:', e);
    }
  }

  /**
   * Управление LED очков
   */
  async setLED(state: LEDState): Promise<void> {
    const { MetaWearables } = NativeModules;
    if (!MetaWearables?.setLEDState) return;

    try {
      const pattern = LED_PATTERNS[state];
      await MetaWearables.setLEDState(pattern.color, pattern.pattern);
    } catch (e) {
      // Тихо игнорируем — LED опционален
    }
  }

  /**
   * Получить статус очков
   */
  async getStatus(): Promise<GlassesStatus | null> {
    const { MetaWearables } = NativeModules;
    if (!MetaWearables?.getGlassesStatus) return null;

    try {
      const status = await MetaWearables.getGlassesStatus();
      this.glassesStatus = status;
      return status;
    } catch {
      return null;
    }
  }

  // ─── Обработчики событий ─────────────────────────────────────────────────

  private handleConnected(): void {
    console.info('[MetaWearables] Очки подключены ✓');
    this.onConnectedCallback?.();
    this.setLED('idle');
  }

  private handleDisconnected(): void {
    console.info('[MetaWearables] Очки отключены');
    this.glassesStatus = null;
    this.onDisconnectedCallback?.();
  }

  private handleStatusUpdate(status: GlassesStatus): void {
    this.glassesStatus = status;
    this.onStatusChangeCallback?.(status);
  }

  private handleVoiceCommand(event: { commandId: string }): void {
    console.info('[MetaWearables] Голосовая команда:', event.commandId);
    this.onVoiceCommandCallback?.(event.commandId);
  }

  // ─── Регистрация колбэков ────────────────────────────────────────────────

  onVoiceCommand(cb: (commandId: string) => void) {
    this.onVoiceCommandCallback = cb;
  }

  onStatusChange(cb: (status: GlassesStatus) => void) {
    this.onStatusChangeCallback = cb;
  }

  onConnected(cb: () => void) {
    this.onConnectedCallback = cb;
  }

  onDisconnected(cb: () => void) {
    this.onDisconnectedCallback = cb;
  }

  // ─── Утилиты ─────────────────────────────────────────────────────────────

  get isReady(): boolean {
    return this.isInitialized;
  }

  get currentStatus(): GlassesStatus | null {
    return this.glassesStatus;
  }

  /**
   * Отключить все слушатели
   */
  destroy(): void {
    this.eventEmitter?.removeAllListeners('onGlassesConnected');
    this.eventEmitter?.removeAllListeners('onGlassesDisconnected');
    this.eventEmitter?.removeAllListeners('onStatusUpdate');
    this.eventEmitter?.removeAllListeners('onVoiceCommand');
    this.isInitialized = false;
  }
}

export const metaWearablesService = new MetaWearablesService();
