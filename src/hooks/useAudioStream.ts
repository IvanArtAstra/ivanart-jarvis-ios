/**
 * useAudioStream — React hook для потокового аудио Jarvis
 *
 * Оборачивает AudioStreamService в удобный интерфейс для компонентов.
 * Управляет жизненным циклом подписок и автоматически чистит ресурсы при unmount.
 *
 * Использование:
 * ```tsx
 * const {
 *   isStreaming, streamState,
 *   transcription, isFinalTranscription,
 *   responseText, lastError,
 *   startStream, stopStream,
 * } = useAudioStream();
 *
 * // Начать запись с микрофона телефона
 * await startStream('phone');
 *
 * // Или с очков
 * await startStream('glasses');
 * ```
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  audioStreamService,
  AudioStreamService,
  StreamState,
  AudioMode,
} from '../services/media/AudioStreamService';

// ─── Типы возвращаемого значения ───────────────────────────────

export interface UseAudioStreamReturn {
  /** Идёт ли сейчас стриминг */
  isStreaming: boolean;
  /** Текущее состояние пайплайна */
  streamState: StreamState;
  /** Текущая транскрипция (промежуточная или финальная) */
  transcription: string;
  /** Финальная ли текущая транскрипция */
  isFinalTranscription: boolean;
  /** Накопленный текст ответа Claude */
  responseText: string;
  /** Ответ полностью получен */
  isResponseDone: boolean;
  /** Последняя ошибка (сбрасывается при новом стриме) */
  lastError: string | null;
  /** Начать стриминг */
  startStream: (mode?: AudioMode) => Promise<void>;
  /** Остановить стриминг */
  stopStream: () => Promise<void>;
}

// ─── Hook ──────────────────────────────────────────────────────

export function useAudioStream(
  /** Можно передать собственный экземпляр сервиса (для тестирования) */
  service?: AudioStreamService,
): UseAudioStreamReturn {
  const svc = service ?? audioStreamService;

  // Состояния
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [transcription, setTranscription] = useState('');
  const [isFinalTranscription, setIsFinalTranscription] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [isResponseDone, setIsResponseDone] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Ref для отслеживания накопленного текста ответа (чтобы избежать stale closure)
  const responseAccRef = useRef('');

  // ─── Подписки на события сервиса ───────────────────────────

  useEffect(() => {
    // Подписка на транскрипции
    const unsubTranscription = svc.onTranscription((text, isFinal) => {
      setTranscription(text);
      setIsFinalTranscription(isFinal);
    });

    // Подписка на ответы Claude
    const unsubResponse = svc.onResponse((text, audioChunk) => {
      if (text) {
        // Сервер может отправлять частичные ответы (streaming)
        // или полный текст. Накапливаем.
        responseAccRef.current += text;
        setResponseText(responseAccRef.current);
      }
      // audioChunk обрабатывается внутри сервиса (TTS воспроизведение)
    });

    // Подписка на состояния
    const unsubState = svc.onStateChange((state) => {
      setStreamState(state);

      // Синхронизируем isStreaming с состоянием сервиса
      setIsStreaming(svc.isStreaming);

      // Когда переходим в idle — ответ завершён
      if (state === 'idle') {
        setIsResponseDone(true);
        setIsStreaming(false);
      }
    });

    // Подписка на ошибки
    const unsubError = svc.onError((error) => {
      setLastError(error);
      setIsStreaming(false);
    });

    // Cleanup при unmount
    return () => {
      unsubTranscription();
      unsubResponse();
      unsubState();
      unsubError();
    };
  }, [svc]);

  // ─── Действия ──────────────────────────────────────────────

  const startStream = useCallback(async (mode: AudioMode = 'phone') => {
    // Сбросить предыдущее состояние
    setLastError(null);
    setTranscription('');
    setIsFinalTranscription(false);
    setResponseText('');
    setIsResponseDone(false);
    responseAccRef.current = '';

    try {
      await svc.startStream(mode);
      setIsStreaming(true);
    } catch (e: any) {
      setLastError(e.message || 'Не удалось начать стриминг');
      setIsStreaming(false);
    }
  }, [svc]);

  const stopStream = useCallback(async () => {
    try {
      await svc.stopStream();
      // isStreaming обновится через stateChange callback
    } catch (e: any) {
      setLastError(e.message || 'Ошибка остановки стриминга');
    }
  }, [svc]);

  return {
    isStreaming,
    streamState,
    transcription,
    isFinalTranscription,
    responseText,
    isResponseDone,
    lastError,
    startStream,
    stopStream,
  };
}
