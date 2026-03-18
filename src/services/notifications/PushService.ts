/**
 * PushService — Firebase Cloud Messaging для push-уведомлений
 *
 * Обрабатывает:
 * - Запрос разрешений на iOS
 * - Получение FCM device token
 * - Регистрацию токена на сервере
 * - Foreground / Background / Tap обработку
 */

import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import NetworkService from '../network/NetworkService';

// ── Типы уведомлений ────────────────────────────────────────

export type NotificationType =
  | 'agent_result'
  | 'morning_briefing'
  | 'alert'
  | 'reminder'
  | 'message';

export interface JarvisNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  timestamp: Date;
  /** Для навигации при тапе */
  screen?: string;
  /** Параметры экрана */
  params?: Record<string, string>;
}

export type NotificationCallback = (notification: JarvisNotification) => void;

// ── Утилиты ─────────────────────────────────────────────────

function parseRemoteMessage(
  message: FirebaseMessagingTypes.RemoteMessage,
): JarvisNotification {
  const data = message.data ?? {};
  return {
    id: message.messageId ?? `notif_${Date.now()}`,
    type: (data.type as NotificationType) ?? 'message',
    title: message.notification?.title ?? data.title ?? 'Jarvis',
    body: message.notification?.body ?? data.body ?? '',
    data: data as Record<string, string>,
    timestamp: new Date(message.sentTime ?? Date.now()),
    screen: data.screen as string | undefined,
    params: data.params ? JSON.parse(data.params as string) : undefined,
  };
}

// ── PushService (Singleton) ─────────────────────────────────

export class PushService {
  private static _instance: PushService | null = null;
  private _deviceToken: string | null = null;
  private _listeners: Set<NotificationCallback> = new Set();
  private _initialized = false;

  private constructor() {}

  static getInstance(): PushService {
    if (!PushService._instance) {
      PushService._instance = new PushService();
    }
    return PushService._instance;
  }

  // ── Публичный API ──────────────────────────────────────

  /** Инициализация — вызвать при старте приложения */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    try {
      // 1. Запрос разрешений (iOS)
      await this._requestPermissions();

      // 2. Получение токена
      this._deviceToken = await messaging().getToken();
      console.log('[PushService] FCM token:', this._deviceToken);

      // 3. Регистрация на сервере
      if (this._deviceToken) {
        await this.registerWithServer(this._deviceToken);
      }

      // 4. Обработка входящих уведомлений

      // Foreground — приложение открыто
      messaging().onMessage(async (remoteMessage) => {
        console.log('[PushService] Foreground message:', remoteMessage.messageId);
        const notification = parseRemoteMessage(remoteMessage);
        this._notifyListeners(notification);
      });

      // Background → Foreground (тап по уведомлению)
      messaging().onNotificationOpenedApp((remoteMessage) => {
        console.log('[PushService] Notification opened app:', remoteMessage.messageId);
        const notification = parseRemoteMessage(remoteMessage);
        this._notifyListeners({ ...notification, data: { ...notification.data, _tapped: 'true' } });
      });

      // App was killed → opened via notification
      const initialNotification = await messaging().getInitialNotification();
      if (initialNotification) {
        console.log('[PushService] App opened from killed state via notification');
        const notification = parseRemoteMessage(initialNotification);
        this._notifyListeners({ ...notification, data: { ...notification.data, _tapped: 'true' } });
      }

      // Обновление токена
      messaging().onTokenRefresh(async (newToken) => {
        console.log('[PushService] Token refreshed:', newToken);
        this._deviceToken = newToken;
        await this.registerWithServer(newToken);
      });

      this._initialized = true;
      console.log('[PushService] Initialized successfully');
    } catch (error) {
      console.error('[PushService] Initialization failed:', error);
      throw error;
    }
  }

  /** Получить текущий device token */
  async getDeviceToken(): Promise<string> {
    if (this._deviceToken) return this._deviceToken;

    this._deviceToken = await messaging().getToken();
    return this._deviceToken;
  }

  /** Зарегистрировать токен на нашем сервере */
  async registerWithServer(token: string): Promise<void> {
    try {
      const network = NetworkService.getInstance();
      const pushUrl = network.getServiceUrl('push');

      const response = await fetch(`${pushUrl}/api/device/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          platform: Platform.OS,
          device_name: `${Platform.OS}-jarvis`,
          app_version: '0.1.0',
        }),
      });

      if (!response.ok) {
        throw new Error(`Server registration failed: ${response.status}`);
      }

      console.log('[PushService] Token registered with server');
    } catch (error) {
      console.warn('[PushService] Failed to register with server:', error);
      // Не бросаем — приложение работает и без push
    }
  }

  /** Подписка на уведомления */
  onNotification(cb: NotificationCallback): () => void {
    this._listeners.add(cb);
    return () => {
      this._listeners.delete(cb);
    };
  }

  /** Проверить, есть ли разрешения */
  async hasPermission(): Promise<boolean> {
    const authStatus = await messaging().hasPermission();
    return (
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL
    );
  }

  // ── Приватные ──────────────────────────────────────────

  private async _requestPermissions(): Promise<void> {
    if (Platform.OS === 'ios') {
      const authStatus = await messaging().requestPermission({
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      });

      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        console.warn('[PushService] Notification permission denied');
      } else {
        console.log('[PushService] Notification permission granted');
      }
    }
    // Android не требует runtime permission для FCM
  }

  private _notifyListeners(notification: JarvisNotification): void {
    this._listeners.forEach((cb) => {
      try {
        cb(notification);
      } catch (e) {
        console.warn('[PushService] Listener error:', e);
      }
    });
  }
}

export default PushService.getInstance();
