/**
 * WakeWord Service — всегда слушает, реагирует на "Джарвис"
 *
 * Реализация через Apple SFSpeechRecognizer (нативный, бесплатный)
 * Работает в фоне пока приложение активно (foreground + background audio)
 *
 * Wake words: "Джарвис", "Jarvis", "Эй Джарвис"
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// Wake word варианты (нечёткое совпадение)
const WAKE_WORDS = [
  'джарвис',
  'jarvis',
  'эй джарвис',
  'hey jarvis',
  'jarvis ',
  'джарвис,',
];

type WakeCallback = () => void;
type PartialCallback = (text: string) => void;

export class WakeWordService {
  private isRunning = false;
  private onWake: WakeCallback | null = null;
  private onPartial: PartialCallback | null = null;
  private recognitionTimer: ReturnType<typeof setTimeout> | null = null;
  private restartDelay = 1500; // ms между циклами распознавания

  /**
   * Проверить содержит ли текст wake word
   */
  private containsWakeWord(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return WAKE_WORDS.some(w => lower.includes(w));
  }

  /**
   * Запустить фоновое прослушивание
   */
  async start(onWake: WakeCallback, onPartial?: PartialCallback): Promise<void> {
    if (this.isRunning) return;

    this.onWake = onWake;
    this.onPartial = onPartial ?? null;
    this.isRunning = true;

    console.log('[WakeWord] Started — listening for "Джарвис"');
    this.runRecognitionLoop();
  }

  /**
   * Цикл непрерывного распознавания
   * SFSpeechRecognizer имеет лимит ~60с на сессию → перезапускаем
   */
  private async runRecognitionLoop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      await this.startOneRecognitionSession();
    } catch (e) {
      console.log('[WakeWord] Session ended, restarting...');
    }

    // Перезапуск после паузы
    if (this.isRunning) {
      this.recognitionTimer = setTimeout(
        () => this.runRecognitionLoop(),
        this.restartDelay
      );
    }
  }

  /**
   * Одна сессия распознавания (через @react-native-voice/voice)
   */
  private startOneRecognitionSession(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const Voice = require('@react-native-voice/voice').default;

      const timeout = setTimeout(() => {
        Voice.stop().catch(() => {});
        resolve(); // таймаут 55с — перезапуск до лимита Apple
      }, 55000);

      Voice.onSpeechPartialResults = (e: any) => {
        const text = e.value?.[0] ?? '';
        this.onPartial?.(text);

        if (this.containsWakeWord(text)) {
          clearTimeout(timeout);
          Voice.stop().catch(() => {});
          console.log('[WakeWord] 🔔 DETECTED:', text);
          this.onWake?.();
          resolve();
        }
      };

      Voice.onSpeechResults = (e: any) => {
        const text = e.value?.[0] ?? '';
        if (this.containsWakeWord(text)) {
          clearTimeout(timeout);
          console.log('[WakeWord] 🔔 DETECTED (final):', text);
          this.onWake?.();
        }
        resolve();
      };

      Voice.onSpeechError = (e: any) => {
        clearTimeout(timeout);
        reject(e);
      };

      try {
        await Voice.start('ru-RU');
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });
  }

  /**
   * Остановить фоновое прослушивание
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.recognitionTimer) {
      clearTimeout(this.recognitionTimer);
      this.recognitionTimer = null;
    }
    try {
      const Voice = require('@react-native-voice/voice').default;
      await Voice.stop();
      await Voice.destroy();
    } catch {}
    console.log('[WakeWord] Stopped');
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const wakeWordService = new WakeWordService();
