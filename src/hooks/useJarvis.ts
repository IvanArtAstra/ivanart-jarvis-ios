/**
 * useJarvis v2 — с фоновым режимом и wake word
 *
 * Режимы:
 * - MANUAL: нажал кнопку → говоришь
 * - ALWAYS_ON: всегда слушает "Джарвис" → активируется
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { voiceService } from '../services/voiceService';
import { jarvisService } from '../services/jarvisService';
import { ttsService } from '../services/ttsService';
import { bleService } from '../services/bleService';
import { wakeWordService } from '../services/wakeWordService';
import { backgroundService } from '../services/backgroundService';
import { notificationService } from '../services/notificationService';
import { agentBridgeService } from '../services/agentBridgeService';
import { commandParserService } from '../services/commandParserService';

export type AppState =
  | 'idle'          // ждём
  | 'wake_listen'   // фоновое прослушивание (wake word)
  | 'listening'     // активно слушаем запрос
  | 'thinking'      // Claude обрабатывает
  | 'speaking'      // Jarvis отвечает
  | 'error';

export type ListenMode = 'manual' | 'always_on';

interface JarvisState {
  appState: AppState;
  listenMode: ListenMode;
  lastQuery: string;
  lastResponse: string;
  partialText: string;        // текст в реальном времени при распознавании
  isGlassesConnected: boolean;
  isBridgeConnected: boolean; // подключён ли Agent Bridge
  error: string | null;
  sessionCount: number;       // сколько раз поговорили за сессию
}

export const useJarvis = () => {
  const [state, setState] = useState<JarvisState>({
    appState: 'idle',
    listenMode: 'manual',
    lastQuery: '',
    lastResponse: 'Jarvis готов. Скажи "Джарвис" или нажми кнопку.',
    partialText: '',
    isGlassesConnected: false,
    isBridgeConnected: false,
    error: null,
    sessionCount: 0,
  });

  const isProcessingRef = useRef(false);

  const update = (patch: Partial<JarvisState>) =>
    setState(prev => ({ ...prev, ...patch }));

  // ─────────────────────────────────────────────
  // Основная обработка запроса (общая для обоих режимов)
  // ─────────────────────────────────────────────
  const processQuery = useCallback(async (transcript: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    update({ lastQuery: transcript, appState: 'thinking', partialText: '' });
    notificationService.hapticResponse();

    // 🔀 Роутинг: сначала проверяем агент-команды, потом Claude
    let response: string;
    const agentCmd = agentBridgeService.connected
      ? await commandParserService.parse(transcript)
      : null;

    if (agentCmd?.response) {
      // Команда агент-системы — мгновенный ответ без Claude
      response = agentCmd.response;
    } else {
      // Обычный разговор — Claude API
      response = await jarvisService.ask(transcript);
    }

    update({
      lastResponse: response,
      appState: 'speaking',
      sessionCount: state.sessionCount + 1,
      error: null,
    });

    // Отправить на очки если подключены
    if (bleService.isConnected()) {
      await notificationService.sendToGlasses(
        { title: 'Jarvis', body: response },
        bleService.sendToGlasses.bind(bleService)
      );
    }

    // Воспроизвести TTS
    await ttsService.speak(response);

    isProcessingRef.current = false;

    // Вернуться в нужный режим
    const nextState = state.listenMode === 'always_on' ? 'wake_listen' : 'idle';
    update({ appState: nextState });

    // Если always_on — перезапустить прослушивание wake word
    if (state.listenMode === 'always_on') {
      startWakeWordListening();
    }
  }, [state.listenMode, state.sessionCount]);

  // ─────────────────────────────────────────────
  // Wake word активация
  // ─────────────────────────────────────────────
  const handleWakeWordDetected = useCallback(async () => {
    if (isProcessingRef.current) return;

    // Стоп-сигнал — вибрация на телефоне
    notificationService.hapticWakeWord();

    // Пауза на wake word прослушивание
    await wakeWordService.stop();

    // Запустить активное прослушивание запроса
    update({ appState: 'listening', partialText: '' });

    await voiceService.startListening(
      (transcript) => processQuery(transcript),
      (error) => {
        update({ error, appState: 'wake_listen' });
        startWakeWordListening(); // перезапуск
      }
    );
  }, [processQuery]);

  // ─────────────────────────────────────────────
  // Запустить фоновое прослушивание wake word
  // ─────────────────────────────────────────────
  const startWakeWordListening = useCallback(async () => {
    await wakeWordService.start(
      handleWakeWordDetected,
      (partial) => update({ partialText: partial })
    );
  }, [handleWakeWordDetected]);

  // ─────────────────────────────────────────────
  // Переключение режимов
  // ─────────────────────────────────────────────
  const setListenMode = useCallback(async (mode: ListenMode) => {
    update({ listenMode: mode });

    if (mode === 'always_on') {
      // Включить keep-alive + wake word
      await backgroundService.startKeepAlive();
      await startWakeWordListening();
      update({ appState: 'wake_listen', lastResponse: 'Слушаю в фоне... Скажи "Джарвис"' });
    } else {
      // Выключить фоновый режим
      await wakeWordService.stop();
      await backgroundService.stopKeepAlive();
      update({ appState: 'idle', lastResponse: 'Нажми кнопку и говори.' });
    }
  }, [startWakeWordListening]);

  // ─────────────────────────────────────────────
  // Ручной режим — кнопка
  // ─────────────────────────────────────────────
  const startVoiceInteraction = useCallback(async () => {
    if (state.appState !== 'idle') return;

    update({ appState: 'listening', partialText: '', error: null });

    await voiceService.startListening(
      (transcript) => processQuery(transcript),
      (error) => {
        update({ error, appState: 'error' });
        setTimeout(() => update({ appState: 'idle' }), 3000);
      }
    );
  }, [state.appState, processQuery]);

  const stopListening = useCallback(async () => {
    await voiceService.stopListening();
    update({ appState: 'idle' });
  }, []);

  // ─────────────────────────────────────────────
  // Ray-Ban подключение
  // ─────────────────────────────────────────────
  const connectGlasses = useCallback(async (): Promise<boolean> => {
    try {
      await bleService.scanForGlasses(async (device) => {
        await bleService.connect(device.id);
        update({
          isGlassesConnected: true,
          lastResponse: `Ray-Ban "${device.name}" подключены ✓ Ответы идут через очки.`,
        });
      });
      return true;
    } catch {
      update({ error: 'Очки не найдены. Убедись что они включены.' });
      return false;
    }
  }, []);

  const disconnectGlasses = useCallback(async () => {
    await bleService.disconnect();
    update({ isGlassesConnected: false });
  }, []);

  // ─────────────────────────────────────────────
  // Agent Bridge — подключение и пуш-уведомления
  // ─────────────────────────────────────────────
  useEffect(() => {
    // Подключить Bridge
    agentBridgeService.connect((connected) => {
      update({ isBridgeConnected: connected });
    });

    // Пуш от агентов → голосом через очки
    agentBridgeService.onAgentResult(async (data) => {
      const preview = data.data?.preview ?? '';
      const file = (data.data?.file ?? '') as string;
      const agent = file.split('_')[0];
      const msg = `${agent} завершил задачу. ${preview.slice(0, 80)}`;
      notificationService.hapticResponse();
      await ttsService.speak(msg);
      update({ lastResponse: msg });
    });
  }, []);

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      voiceService.destroy();
      wakeWordService.stop();
      backgroundService.stopKeepAlive();
      ttsService.stop();
      agentBridgeService.disconnect();
    };
  }, []);

  return {
    ...state,
    startVoiceInteraction,
    stopListening,
    setListenMode,
    connectGlasses,
    disconnectGlasses,
  };
};
