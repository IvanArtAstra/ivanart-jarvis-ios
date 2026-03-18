/**
 * AudioStreamService.ts — Потоковая передача аудио: iOS ↔ Server
 *
 * Полный пайплайн реального времени:
 *   1. Захват аудио (с очков через Meta SDK или с микрофона телефона)
 *   2. Стриминг бинарных фреймов по WebSocket на сервер (порт 8769)
 *   3. Получение транскрипции (Whisper) + ответа Claude обратно
 *   4. Потоковое воспроизведение TTS — начинаем играть ДО получения полного ответа
 *
 * Протокол:
 *   Client → Server:
 *     - binary frames: сырые PCM/opus аудио-чанки
 *     - JSON: { type: "start", mode: "glasses"|"phone", sampleRate: 16000, channels: 1, format: "pcm16" }
 *     - JSON: { type: "stop" }
 *     - JSON: { type: "config", language: "ru", voiceId: "..." }
 *
 *   Server → Client:
 *     - JSON: { type: "transcription", text: "...", final: true|false }
 *     - JSON: { type: "response", text: "...", done: true|false }
 *     - binary frames: TTS аудио-чанки (mp3/pcm)
 *     - JSON: { type: "tts_start" } / { type: "tts_end" }
 *     - JSON: { type: "error", message: "..." }
 *     - JSON: { type: "state", state: "transcribing"|"thinking"|"speaking" }
 */

import { Platform, PermissionsAndroid } from 'react-native';
import Sound from 'react-native-sound';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectionManager } from '../glasses';

// ─── Типы ──────────────────────────────────────────────────────

/** Состояния пайплайна */
export type StreamState =
  | 'idle'          // Ожидание — ничего не делаем
  | 'connecting'    // Подключение к WS серверу
  | 'recording'     // Захват и отправка аудио
  | 'transcribing'  // Сервер распознаёт речь (Whisper)
  | 'responding'    // Claude генерирует ответ
  | 'speaking'      // Воспроизводим TTS ответ
  | 'error';        // Ошибка — можно перезапустить

/** Режим захвата аудио */
export type AudioMode = 'glasses' | 'phone';

/** Конфигурация сервиса */
export interface AudioStreamConfig {
  /** URL WebSocket сервера */
  serverUrl: string;
  /** Частота дискретизации (по умолчанию 16000 Hz — оптимально для Whisper) */
  sampleRate: number;
  /** Количество каналов (моно = 1) */
  channels: number;
  /** Формат аудио: pcm16 (сырой) или opus (сжатый) */
  format: 'pcm16' | 'opus';
  /** Язык для распознавания */
  language: string;
  /** ElevenLabs Voice ID для TTS */
  voiceId: string;
  /** Автоматический реконнект при потере связи */
  autoReconnect: boolean;
  /** Максимальное кол-во попыток реконнекта */
  maxReconnectAttempts: number;
  /** Задержка между попытками реконнекта (мс) */
  reconnectDelayMs: number;
}

/** Коллбэки для подписки на события */
type TranscriptionCallback = (text: string, isFinal: boolean) => void;
type ResponseCallback = (text: string, audioChunk?: ArrayBuffer) => void;
type StateChangeCallback = (state: StreamState) => void;
type ErrorCallback = (error: string) => void;

/** Сообщение от сервера (JSON) */
interface ServerMessage {
  type: 'transcription' | 'response' | 'tts_start' | 'tts_end' | 'error' | 'state';
  text?: string;
  final?: boolean;
  done?: boolean;
  message?: string;
  state?: string;
}

// ─── Константы ─────────────────────────────────────────────────

const STORAGE_KEY_AUDIO_STREAM_URL = '@jarvis/audio_stream_url';
const DEFAULT_SERVER_URL = 'ws://192.168.0.39:8769';

/** Размер буфера аудио перед отправкой (байт). ~100ms при 16kHz/16bit/mono = 3200 bytes */
const AUDIO_CHUNK_BUFFER_SIZE = 3200;

/** Таймаут подключения к серверу (мс) */
const CONNECT_TIMEOUT_MS = 10000;

/** Интервал пинга для поддержания соединения (мс) */
const PING_INTERVAL_MS = 30000;

// ─── AudioStreamService ────────────────────────────────────────

export class AudioStreamService {
  // Конфигурация
  private config: AudioStreamConfig;

  // WebSocket
  private ws: WebSocket | null = null;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pingIntervalId: ReturnType<typeof setInterval> | null = null;

  // Состояние
  private _state: StreamState = 'idle';
  private _isStreaming = false;
  private currentMode: AudioMode = 'phone';
  private reconnectAttempts = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isManualStop = false;

  // Аудио буфер — накапливаем мелкие чанки перед отправкой
  private audioBuffer: Uint8Array[] = [];
  private audioBufferSize = 0;

  // TTS воспроизведение — потоковое
  private ttsChunks: ArrayBuffer[] = [];
  private ttsChunkIndex = 0;
  private isPlayingTTS = false;
  private currentSound: Sound | null = null;
  private ttsFileCounter = 0;

  // Коллбэки подписчиков
  private transcriptionCallbacks: TranscriptionCallback[] = [];
  private responseCallbacks: ResponseCallback[] = [];
  private stateChangeCallbacks: StateChangeCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  // Текущая транскрипция (накопленная)
  private accumulatedTranscription = '';

  constructor(config?: Partial<AudioStreamConfig>) {
    this.config = {
      serverUrl: DEFAULT_SERVER_URL,
      sampleRate: 16000,
      channels: 1,
      format: 'pcm16',
      language: 'ru',
      voiceId: 'pNInz6obpgDQGcFmaJgB', // Jarvis default
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelayMs: 3000,
      ...config,
    };
  }

  // ─── Public API ────────────────────────────────────────────

  /**
   * Начать потоковую запись и отправку аудио.
   * @param mode — 'glasses' (через Meta SDK) или 'phone' (микрофон телефона)
   */
  async startStream(mode: AudioMode = 'phone'): Promise<void> {
    if (this._isStreaming) {
      console.warn('[AudioStream] Уже идёт стриминг — игнорируем повторный вызов');
      return;
    }

    this.isManualStop = false;
    this.currentMode = mode;
    this.accumulatedTranscription = '';
    this.ttsChunks = [];
    this.ttsChunkIndex = 0;

    // Загрузить сохранённый URL сервера
    await this.loadServerUrl();

    // Запросить разрешения
    const hasPermission = await this.requestMicrophonePermission();
    if (!hasPermission) {
      this.emitError('Нет доступа к микрофону');
      return;
    }

    // Подключиться к серверу
    this.setState('connecting');
    const connected = await this.connectWebSocket();
    if (!connected) {
      this.setState('error');
      this.emitError('Не удалось подключиться к серверу аудио');
      return;
    }

    // Отправить конфигурацию сессии
    this.sendJSON({
      type: 'config',
      language: this.config.language,
      voiceId: this.config.voiceId,
    });

    // Начать захват аудио
    try {
      await this.startAudioCapture(mode);
      this._isStreaming = true;
      this.setState('recording');
      this.reconnectAttempts = 0;
      console.info(`[AudioStream] ▶ Стриминг начат: mode=${mode}, server=${this.config.serverUrl}`);
    } catch (e: any) {
      console.error('[AudioStream] Ошибка запуска захвата:', e);
      this.emitError(`Ошибка микрофона: ${e.message}`);
      this.setState('error');
      this.closeWebSocket();
    }
  }

  /**
   * Остановить запись и передачу аудио.
   * Сервер завершит обработку текущего буфера и вернёт финальный ответ.
   */
  async stopStream(): Promise<void> {
    if (!this._isStreaming && this._state === 'idle') return;

    console.info('[AudioStream] ⏹ Остановка стриминга...');
    this.isManualStop = true;
    this._isStreaming = false;

    // Остановить захват аудио
    await this.stopAudioCapture();

    // Отправить оставшийся буфер
    this.flushAudioBuffer();

    // Уведомить сервер об окончании
    this.sendJSON({ type: 'stop' });

    // Не закрываем WS сразу — ждём финальный ответ от сервера
    // WS закроется после получения tts_end или по таймауту

    // Таймаут на случай если сервер не ответит
    setTimeout(() => {
      if (this._state !== 'idle') {
        console.warn('[AudioStream] Таймаут ожидания финального ответа — закрываем');
        this.cleanup();
      }
    }, 30000);
  }

  /** Полная остановка и очистка ресурсов */
  destroy(): void {
    this.isManualStop = true;
    this._isStreaming = false;
    this.cleanup();
    this.transcriptionCallbacks = [];
    this.responseCallbacks = [];
    this.stateChangeCallbacks = [];
    this.errorCallbacks = [];
  }

  // ─── Подписки на события ───────────────────────────────────

  /** Подписка на транскрипцию (промежуточную и финальную) */
  onTranscription(cb: TranscriptionCallback): () => void {
    this.transcriptionCallbacks.push(cb);
    return () => {
      this.transcriptionCallbacks = this.transcriptionCallbacks.filter(c => c !== cb);
    };
  }

  /** Подписка на ответы Claude (текст + опционально аудио-чанк) */
  onResponse(cb: ResponseCallback): () => void {
    this.responseCallbacks.push(cb);
    return () => {
      this.responseCallbacks = this.responseCallbacks.filter(c => c !== cb);
    };
  }

  /** Подписка на изменения состояния пайплайна */
  onStateChange(cb: StateChangeCallback): () => void {
    this.stateChangeCallbacks.push(cb);
    return () => {
      this.stateChangeCallbacks = this.stateChangeCallbacks.filter(c => c !== cb);
    };
  }

  /** Подписка на ошибки */
  onError(cb: ErrorCallback): () => void {
    this.errorCallbacks.push(cb);
    return () => {
      this.errorCallbacks = this.errorCallbacks.filter(c => c !== cb);
    };
  }

  // ─── Геттеры ───────────────────────────────────────────────

  get isStreaming(): boolean {
    return this._isStreaming;
  }

  get state(): StreamState {
    return this._state;
  }

  get serverUrl(): string {
    return this.config.serverUrl;
  }

  // ─── Настройки ─────────────────────────────────────────────

  /** Установить URL сервера (сохраняется в AsyncStorage) */
  async setServerUrl(url: string): Promise<void> {
    this.config.serverUrl = url.replace(/\/$/, '');
    await AsyncStorage.setItem(STORAGE_KEY_AUDIO_STREAM_URL, this.config.serverUrl);
  }

  /** Установить язык распознавания */
  setLanguage(language: string): void {
    this.config.language = language;
    // Если уже подключены — отправить обновлённую конфигурацию
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendJSON({ type: 'config', language });
    }
  }

  /** Установить голос TTS */
  setVoiceId(voiceId: string): void {
    this.config.voiceId = voiceId;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendJSON({ type: 'config', voiceId });
    }
  }

  // ─── WebSocket ─────────────────────────────────────────────

  private connectWebSocket(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        // Очистить предыдущее соединение
        this.closeWebSocket();

        console.info(`[AudioStream] Подключение к ${this.config.serverUrl}...`);
        this.ws = new WebSocket(this.config.serverUrl);
        this.ws.binaryType = 'arraybuffer';

        // Таймаут подключения
        this.connectTimeoutId = setTimeout(() => {
          console.warn('[AudioStream] Таймаут подключения');
          this.ws?.close();
          resolve(false);
        }, CONNECT_TIMEOUT_MS);

        this.ws.onopen = () => {
          if (this.connectTimeoutId) {
            clearTimeout(this.connectTimeoutId);
            this.connectTimeoutId = null;
          }
          console.info('[AudioStream] ✅ WebSocket подключён');
          this.startPingInterval();
          resolve(true);
        };

        this.ws.onmessage = (event: MessageEvent) => {
          this.handleServerMessage(event);
        };

        this.ws.onclose = (event: CloseEvent) => {
          console.info(`[AudioStream] WebSocket закрыт: code=${event.code} reason=${event.reason}`);
          this.stopPingInterval();

          if (!this.isManualStop && this.config.autoReconnect && this._isStreaming) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error: Event) => {
          console.error('[AudioStream] WebSocket ошибка:', error);
          if (this.connectTimeoutId) {
            clearTimeout(this.connectTimeoutId);
            this.connectTimeoutId = null;
          }
          // onclose будет вызван автоматически
        };
      } catch (e: any) {
        console.error('[AudioStream] Ошибка создания WebSocket:', e);
        resolve(false);
      }
    });
  }

  private closeWebSocket(): void {
    this.stopPingInterval();
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
    if (this.ws) {
      // Удаляем обработчики чтобы не срабатывал реконнект
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingIntervalId = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendJSON({ type: 'ping' });
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingInterval(): void {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  // ─── Реконнект ─────────────────────────────────────────────

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[AudioStream] Превышено макс. кол-во попыток реконнекта');
      this.emitError('Потеряно соединение с сервером');
      this.setState('error');
      this._isStreaming = false;
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelayMs * this.reconnectAttempts; // Экспоненциальная задержка
    console.info(`[AudioStream] Реконнект через ${delay}мс (попытка ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimeoutId = setTimeout(async () => {
      const connected = await this.connectWebSocket();
      if (connected) {
        console.info('[AudioStream] ✅ Реконнект успешен');
        this.reconnectAttempts = 0;
        // Переотправить конфигурацию
        this.sendJSON({
          type: 'config',
          language: this.config.language,
          voiceId: this.config.voiceId,
        });
        // Уведомить сервер что стриминг продолжается
        this.sendJSON({
          type: 'start',
          mode: this.currentMode,
          sampleRate: this.config.sampleRate,
          channels: this.config.channels,
          format: this.config.format,
        });
      }
    }, delay);
  }

  // ─── Обработка сообщений от сервера ────────────────────────

  private handleServerMessage(event: MessageEvent): void {
    // Бинарные данные — TTS аудио-чанк
    if (event.data instanceof ArrayBuffer) {
      this.handleTTSChunk(event.data);
      return;
    }

    // JSON сообщение
    try {
      const msg: ServerMessage = JSON.parse(event.data as string);

      switch (msg.type) {
        case 'transcription':
          this.handleTranscription(msg);
          break;

        case 'response':
          this.handleResponse(msg);
          break;

        case 'tts_start':
          // Начало потока TTS — готовимся к воспроизведению
          this.ttsChunks = [];
          this.ttsChunkIndex = 0;
          this.ttsFileCounter++;
          this.setState('speaking');
          break;

        case 'tts_end':
          // Конец потока TTS — финализация
          console.info('[AudioStream] TTS поток завершён');
          // Если стриминг был остановлен — переходим в idle
          if (!this._isStreaming) {
            this.finishPlaybackAndCleanup();
          }
          break;

        case 'state':
          // Сервер сообщает о своём состоянии
          if (msg.state === 'transcribing') this.setState('transcribing');
          else if (msg.state === 'thinking') this.setState('responding');
          else if (msg.state === 'speaking') this.setState('speaking');
          break;

        case 'error':
          console.error('[AudioStream] Ошибка от сервера:', msg.message);
          this.emitError(msg.message || 'Ошибка сервера');
          break;

        default:
          console.warn('[AudioStream] Неизвестный тип сообщения:', msg.type);
      }
    } catch (e) {
      console.error('[AudioStream] Ошибка парсинга сообщения от сервера:', e);
    }
  }

  private handleTranscription(msg: ServerMessage): void {
    const text = msg.text || '';
    const isFinal = msg.final ?? false;

    if (isFinal) {
      this.accumulatedTranscription = text;
    }

    // Уведомляем подписчиков
    this.transcriptionCallbacks.forEach(cb => {
      try { cb(text, isFinal); } catch (e) {
        console.error('[AudioStream] Ошибка в transcription callback:', e);
      }
    });
  }

  private handleResponse(msg: ServerMessage): void {
    const text = msg.text || '';
    const isDone = msg.done ?? false;

    // Уведомляем подписчиков
    this.responseCallbacks.forEach(cb => {
      try { cb(text); } catch (e) {
        console.error('[AudioStream] Ошибка в response callback:', e);
      }
    });

    if (isDone && !this._isStreaming) {
      // Ответ полный и стриминг остановлен — ждём TTS
    }
  }

  // ─── Потоковое TTS воспроизведение ─────────────────────────

  /**
   * Обработка TTS аудио-чанка от сервера.
   * Стратегия: накапливаем первые N чанков, затем начинаем воспроизведение.
   * Пока играет первый файл — второй уже скачивается. Бесшовный поток.
   */
  private handleTTSChunk(data: ArrayBuffer): void {
    this.ttsChunks.push(data);

    // Уведомляем подписчиков (могут использовать для визуализации)
    this.responseCallbacks.forEach(cb => {
      try { cb('', data); } catch (e) {
        console.error('[AudioStream] Ошибка в response callback (audio):', e);
      }
    });

    // Начинаем воспроизведение после первого чанка
    // (сервер отправляет достаточно большие чанки ~0.5-1 сек)
    if (!this.isPlayingTTS && this.ttsChunks.length >= 1) {
      this.playNextTTSChunk();
    }
  }

  /**
   * Воспроизвести следующий TTS чанк.
   * Сохраняем чанк в файл → воспроизводим → удаляем → следующий.
   */
  private async playNextTTSChunk(): Promise<void> {
    if (this.ttsChunkIndex >= this.ttsChunks.length) {
      this.isPlayingTTS = false;
      return;
    }

    this.isPlayingTTS = true;
    const chunk = this.ttsChunks[this.ttsChunkIndex];
    this.ttsChunkIndex++;

    try {
      // Сохраняем чанк во временный файл
      const filePath = `${RNFS.CachesDirectoryPath}/jarvis_tts_${this.ttsFileCounter}_${this.ttsChunkIndex}.mp3`;
      const base64Data = this.arrayBufferToBase64(chunk);
      await RNFS.writeFile(filePath, base64Data, 'base64');

      // Воспроизводим
      await this.playAudioFile(filePath);

      // Удаляем временный файл
      try { await RNFS.unlink(filePath); } catch {}

      // Следующий чанк (рекурсивно)
      this.playNextTTSChunk();
    } catch (e) {
      console.error('[AudioStream] Ошибка воспроизведения TTS чанка:', e);
      this.isPlayingTTS = false;
    }
  }

  private playAudioFile(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      Sound.setCategory('Playback');
      this.currentSound = new Sound(path, '', (error) => {
        if (error) {
          console.error('[AudioStream] Ошибка загрузки аудио:', error);
          reject(error);
          return;
        }
        this.currentSound?.play((success) => {
          this.currentSound?.release();
          this.currentSound = null;
          resolve();
        });
      });
    });
  }

  private stopTTSPlayback(): void {
    if (this.currentSound) {
      this.currentSound.stop();
      this.currentSound.release();
      this.currentSound = null;
    }
    this.isPlayingTTS = false;
    this.ttsChunks = [];
    this.ttsChunkIndex = 0;
  }

  /** Дождаться окончания воспроизведения и перейти в idle */
  private async finishPlaybackAndCleanup(): Promise<void> {
    // Ждём пока доиграет текущий TTS
    const waitForPlayback = (): Promise<void> => {
      return new Promise((resolve) => {
        const check = () => {
          if (!this.isPlayingTTS) {
            resolve();
          } else {
            setTimeout(check, 200);
          }
        };
        check();
      });
    };

    await waitForPlayback();
    this.cleanup();
  }

  // ─── Захват аудио ──────────────────────────────────────────

  private async startAudioCapture(mode: AudioMode): Promise<void> {
    // Отправляем серверу сигнал начала стрима
    this.sendJSON({
      type: 'start',
      mode,
      sampleRate: this.config.sampleRate,
      channels: this.config.channels,
      format: this.config.format,
    });

    if (mode === 'glasses') {
      await this.startGlassesCapture();
    } else {
      await this.startPhoneCapture();
    }
  }

  /**
   * Захват аудио с очков через Meta SDK.
   * ConnectionManager.startAudioStream() даёт callback с PCM чанками.
   */
  private async startGlassesCapture(): Promise<void> {
    try {
      await connectionManager.startAudioStream((data: ArrayBuffer) => {
        this.onAudioChunkCaptured(data);
      });
      console.info('[AudioStream] 🕶 Захват с очков запущен');
    } catch (e: any) {
      throw new Error(`Не удалось запустить аудио с очков: ${e.message}`);
    }
  }

  /**
   * Захват аудио с микрофона телефона.
   * Используем live-audio-stream или expo-av для потоковой записи.
   *
   * ВАЖНО: Для потоковой передачи PCM нужна нативная библиотека.
   * react-native-live-audio-stream или react-native-audio-record
   * дают raw PCM чанки через callback.
   */
  private async startPhoneCapture(): Promise<void> {
    try {
      // Динамический импорт — библиотека может быть не установлена
      const LiveAudioStream = require('react-native-live-audio-stream').default;

      LiveAudioStream.init({
        sampleRate: this.config.sampleRate,
        channels: this.config.channels,
        bitsPerSample: 16,
        audioSource: 6, // VOICE_RECOGNITION — оптимизировано для речи
        bufferSize: AUDIO_CHUNK_BUFFER_SIZE,
      });

      LiveAudioStream.on('data', (base64Data: string) => {
        // Конвертируем base64 → ArrayBuffer
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        this.onAudioChunkCaptured(bytes.buffer);
      });

      LiveAudioStream.start();
      console.info('[AudioStream] 📱 Захват с микрофона запущен');
    } catch (e: any) {
      // Fallback: попробовать react-native-audio-record
      try {
        const AudioRecord = require('react-native-audio-record').default;

        AudioRecord.init({
          sampleRate: this.config.sampleRate,
          channels: this.config.channels,
          bitsPerSample: 16,
          audioSource: 6,
          wavFile: '', // Пустой = стриминг без файла
        });

        AudioRecord.on('data', (base64Data: string) => {
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          this.onAudioChunkCaptured(bytes.buffer);
        });

        AudioRecord.start();
        console.info('[AudioStream] 📱 Захват с микрофона (fallback) запущен');
      } catch (e2: any) {
        throw new Error(
          'Не найдена библиотека для потоковой записи. ' +
          'Установи react-native-live-audio-stream или react-native-audio-record'
        );
      }
    }
  }

  private async stopAudioCapture(): Promise<void> {
    if (this.currentMode === 'glasses') {
      try { await connectionManager.stopAudioStream(); } catch {}
    } else {
      try {
        const LiveAudioStream = require('react-native-live-audio-stream').default;
        LiveAudioStream.stop();
      } catch {
        try {
          const AudioRecord = require('react-native-audio-record').default;
          AudioRecord.stop();
        } catch {}
      }
    }
  }

  // ─── Обработка захваченного аудио ──────────────────────────

  /**
   * Callback для каждого захваченного аудио-чанка.
   * Буферизуем мелкие чанки и отправляем пачками по WS.
   */
  private onAudioChunkCaptured(data: ArrayBuffer): void {
    if (!this._isStreaming || this.ws?.readyState !== WebSocket.OPEN) return;

    const chunk = new Uint8Array(data);
    this.audioBuffer.push(chunk);
    this.audioBufferSize += chunk.byteLength;

    // Отправляем когда накопили достаточно
    if (this.audioBufferSize >= AUDIO_CHUNK_BUFFER_SIZE) {
      this.flushAudioBuffer();
    }
  }

  /** Объединить буферизованные чанки и отправить одним бинарным фреймом */
  private flushAudioBuffer(): void {
    if (this.audioBuffer.length === 0) return;
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    // Объединяем все чанки в один ArrayBuffer
    const totalSize = this.audioBuffer.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of this.audioBuffer) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // Отправляем бинарный фрейм
    try {
      this.ws.send(combined.buffer);
    } catch (e) {
      console.error('[AudioStream] Ошибка отправки аудио:', e);
    }

    // Очищаем буфер
    this.audioBuffer = [];
    this.audioBufferSize = 0;
  }

  // ─── Разрешения ────────────────────────────────────────────

  private async requestMicrophonePermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Доступ к микрофону',
            message: 'Jarvis нужен доступ к микрофону для голосовых команд',
            buttonPositive: 'Разрешить',
            buttonNegative: 'Отказать',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch {
        return false;
      }
    }
    // iOS — разрешение через Info.plist, запросится автоматически
    return true;
  }

  // ─── Утилиты ───────────────────────────────────────────────

  private sendJSON(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (e) {
        console.error('[AudioStream] Ошибка отправки JSON:', e);
      }
    }
  }

  private setState(newState: StreamState): void {
    if (this._state === newState) return;
    const prevState = this._state;
    this._state = newState;
    console.info(`[AudioStream] Состояние: ${prevState} → ${newState}`);

    this.stateChangeCallbacks.forEach(cb => {
      try { cb(newState); } catch (e) {
        console.error('[AudioStream] Ошибка в stateChange callback:', e);
      }
    });
  }

  private emitError(message: string): void {
    this.errorCallbacks.forEach(cb => {
      try { cb(message); } catch (e) {
        console.error('[AudioStream] Ошибка в error callback:', e);
      }
    });
  }

  private cleanup(): void {
    this._isStreaming = false;
    this.stopTTSPlayback();
    this.closeWebSocket();

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    this.audioBuffer = [];
    this.audioBufferSize = 0;
    this.accumulatedTranscription = '';

    this.setState('idle');
  }

  private async loadServerUrl(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY_AUDIO_STREAM_URL);
      if (saved) this.config.serverUrl = saved;
    } catch {}
  }

  /** ArrayBuffer → base64 string (для сохранения аудио в файл) */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

// ─── Singleton ─────────────────────────────────────────────────

export const audioStreamService = new AudioStreamService();
