/**
 * TTS Service — синтез речи Jarvis
 * ElevenLabs API → аудио → динамики Ray-Ban через BLE
 */

import Sound from 'react-native-sound';
import RNFS from 'react-native-fs';
import { bleService } from './bleService';
import { ELEVENLABS_API_KEY, JARVIS_VOICE_ID } from '../utils/config';

// Настройки голоса Jarvis
const TTS_CONFIG = {
  model_id: 'eleven_multilingual_v2',
  voice_settings: {
    stability: 0.75,
    similarity_boost: 0.85,
    style: 0.2,
    use_speaker_boost: true,
  },
};

export class TTSService {
  private currentSound: Sound | null = null;

  /**
   * Озвучить текст
   * Если Ray-Ban подключены → через BLE на динамики очков
   * Если нет → через динамик телефона
   */
  async speak(text: string): Promise<void> {
    // Остановить предыдущее воспроизведение
    await this.stop();

    if (bleService.isConnected()) {
      // Маршрут 1: Ray-Ban BLE
      await this.speakViaGlasses(text);
    } else {
      // Маршрут 2: телефонный динамик
      await this.speakViaPhone(text);
    }
  }

  /**
   * Отправить текст на Ray-Ban (очки сами воспроизведут через встроенный TTS)
   */
  private async speakViaGlasses(text: string): Promise<void> {
    try {
      // Отправляем команду TTS на очки через BLE
      const command = JSON.stringify({
        type: 'tts',
        text: text,
        lang: 'ru',
      });
      await bleService.sendToGlasses(command);
      console.log('[TTS] Sent to glasses:', text.slice(0, 50));
    } catch (e) {
      console.error('[TTS] BLE send failed, fallback to phone:', e);
      await this.speakViaPhone(text);
    }
  }

  /**
   * ElevenLabs → mp3 → динамик телефона
   */
  private async speakViaPhone(text: string): Promise<void> {
    try {
      // Запросить аудио у ElevenLabs
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${JARVIS_VOICE_ID}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          ...TTS_CONFIG,
        }),
      });

      if (!response.ok) throw new Error(`ElevenLabs error: ${response.status}`);

      // Сохранить mp3 во временный файл
      const audioBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(audioBuffer).toString('base64');
      const audioPath = `${RNFS.CachesDirectoryPath}/jarvis_response.mp3`;
      await RNFS.writeFile(audioPath, audioBase64, 'base64');

      // Воспроизвести
      await this.playFile(audioPath);

    } catch (e) {
      console.error('[TTS] ElevenLabs error:', e);
      // Последний fallback — системный TTS (через react-native-tts если установлен)
    }
  }

  /**
   * Воспроизвести mp3 файл
   */
  private playFile(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      Sound.setCategory('Playback');
      this.currentSound = new Sound(path, '', (error) => {
        if (error) {
          reject(error);
          return;
        }
        this.currentSound?.play((success) => {
          if (success) resolve();
          else reject(new Error('Playback failed'));
        });
      });
    });
  }

  /**
   * Остановить воспроизведение
   */
  async stop(): Promise<void> {
    if (this.currentSound) {
      this.currentSound.stop();
      this.currentSound.release();
      this.currentSound = null;
    }
  }
}

export const ttsService = new TTSService();
