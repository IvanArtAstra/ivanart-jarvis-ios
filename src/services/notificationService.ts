/**
 * Notification Service — уведомления на Ray-Ban очки
 * Когда Jarvis что-то важное находит → показывает на очках
 */

import { Vibration, Platform } from 'react-native';

export interface GlassesNotification {
  title: string;
  body: string;
  priority?: 'low' | 'normal' | 'high';
}

export class NotificationService {
  /**
   * Показать уведомление на Ray-Ban дисплее
   * Ray-Ban Meta Display поддерживает текстовые нотификации через BLE
   */
  async sendToGlasses(
    notification: GlassesNotification,
    bleSend: (text: string) => Promise<void>
  ): Promise<void> {
    const payload = JSON.stringify({
      type: 'notification',
      title: notification.title,
      body: notification.body,
      priority: notification.priority ?? 'normal',
      timestamp: Date.now(),
    });

    try {
      await bleSend(payload);
      console.log('[Notification] Sent to glasses:', notification.title);
    } catch (e) {
      console.error('[Notification] Failed to send:', e);
    }
  }

  /**
   * Тактильная обратная связь при активации wake word
   */
  hapticWakeWord(): void {
    // Короткая вибрация — "я тебя слышу"
    Vibration.vibrate([0, 50, 100, 50]);
  }

  /**
   * Тактильная обратная связь при получении ответа
   */
  hapticResponse(): void {
    Vibration.vibrate(30);
  }
}

export const notificationService = new NotificationService();
