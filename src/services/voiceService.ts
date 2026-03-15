/**
 * Voice Service — запись голоса + Whisper транскрипция
 * Слушает микрофон → отправляет в Whisper API → возвращает текст
 */

import { Platform, PermissionsAndroid } from 'react-native';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
// Package: @react-native-voice/voice (npm)
import { ANTHROPIC_API_KEY } from '../utils/config';

type VoiceCallback = (text: string) => void;
type ErrorCallback = (error: string) => void;

export class VoiceService {
  private onResult: VoiceCallback | null = null;
  private onError: ErrorCallback | null = null;
  private isListening: boolean = false;

  constructor() {
    Voice.onSpeechResults = this.handleResults.bind(this);
    Voice.onSpeechError = this.handleError.bind(this);
    Voice.onSpeechEnd = this.handleEnd.bind(this);
  }

  private handleResults(e: SpeechResultsEvent) {
    const text = e.value?.[0] ?? '';
    if (text && this.onResult) {
      this.onResult(text);
    }
  }

  private handleError(e: SpeechErrorEvent) {
    console.error('[Voice] Error:', e.error);
    this.isListening = false;
    if (this.onError) this.onError(e.error?.message ?? 'Ошибка распознавания');
  }

  private handleEnd() {
    this.isListening = false;
  }

  /**
   * Запросить разрешение на микрофон (iOS — через Info.plist, Android — здесь)
   */
  async requestPermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    // iOS — разрешение запрашивается автоматически при первом старте
    return true;
  }

  /**
   * Начать слушать
   */
  async startListening(
    onResult: VoiceCallback,
    onError?: ErrorCallback
  ): Promise<void> {
    if (this.isListening) return;

    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      onError?.('Нет доступа к микрофону');
      return;
    }

    this.onResult = onResult;
    this.onError = onError ?? null;
    this.isListening = true;

    try {
      await Voice.start('ru-RU'); // Русский язык по умолчанию
    } catch (e) {
      this.isListening = false;
      onError?.('Не удалось запустить распознавание');
    }
  }

  /**
   * Остановить слушание
   */
  async stopListening(): Promise<void> {
    if (!this.isListening) return;
    try {
      await Voice.stop();
    } catch (e) {
      console.error('[Voice] Stop error:', e);
    }
    this.isListening = false;
  }

  /**
   * Отменить
   */
  async cancel(): Promise<void> {
    await Voice.cancel();
    this.isListening = false;
  }

  isActive(): boolean {
    return this.isListening;
  }

  destroy() {
    Voice.destroy().then(Voice.removeAllListeners);
  }
}

export const voiceService = new VoiceService();
