/**
 * Background Service — держит приложение живым в фоне
 *
 * iOS убивает фоновые приложения через ~3 минуты.
 * Трюк: запустить тихую аудио сессию (AVAudioSession)
 * → iOS думает что приложение воспроизводит аудио → не убивает.
 *
 * Это легальный метод используемый Spotify, Waze и т.д.
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import Sound from 'react-native-sound';

// Путь к тихому аудио файлу (0.1 секунды тишины, зациклено)
const SILENT_AUDIO = 'silence.mp3'; // добавить в assets/sounds/

export class BackgroundService {
  private silentSound: Sound | null = null;
  private appStateSubscription: any = null;
  private isKeepAlive = false;

  /**
   * Запустить keep-alive режим
   * Вызывать при включении wake word режима
   */
  async startKeepAlive(): Promise<void> {
    if (this.isKeepAlive) return;
    if (Platform.OS !== 'ios') return;

    this.isKeepAlive = true;

    // Настроить аудио сессию для фонового воспроизведения
    Sound.setCategory('PlayAndRecord', true);
    Sound.setMode('Default');
    Sound.setActive(true);

    // Запустить тихий звук в петле
    this.playSilentLoop();

    // Слушать смену состояния приложения
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange.bind(this)
    );

    console.log('[Background] Keep-alive started');
  }

  /**
   * Тихий аудио цикл
   */
  private playSilentLoop(): void {
    if (!this.isKeepAlive) return;

    Sound.setCategory('PlayAndRecord', true);

    this.silentSound = new Sound(SILENT_AUDIO, Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        // Если файла нет — создаём аудио сессию через задержку
        setTimeout(() => this.playSilentLoop(), 30000);
        return;
      }

      this.silentSound!.setVolume(0); // абсолютная тишина
      this.silentSound!.setNumberOfLoops(-1); // бесконечно
      this.silentSound!.play((success) => {
        if (!success && this.isKeepAlive) {
          // Перезапустить если упало
          setTimeout(() => this.playSilentLoop(), 1000);
        }
      });
    });
  }

  private handleAppStateChange(nextState: AppStateStatus): void {
    console.log('[Background] App state:', nextState);

    if (nextState === 'background' && this.isKeepAlive) {
      // Приложение ушло в фон — убедимся что аудио сессия активна
      Sound.setActive(true);
      console.log('[Background] App in background — keeping alive');
    }

    if (nextState === 'active') {
      console.log('[Background] App returned to foreground');
    }
  }

  /**
   * Остановить keep-alive
   */
  async stopKeepAlive(): Promise<void> {
    this.isKeepAlive = false;

    if (this.silentSound) {
      this.silentSound.stop();
      this.silentSound.release();
      this.silentSound = null;
    }

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    Sound.setActive(false);
    console.log('[Background] Keep-alive stopped');
  }

  isActive(): boolean {
    return this.isKeepAlive;
  }
}

export const backgroundService = new BackgroundService();
