/**
 * useJarvis — главный хук
 * Оркестрирует: Voice → Jarvis AI → TTS → Ray-Ban
 */

import { useState, useCallback, useEffect } from 'react';
import { voiceService } from '../services/voiceService';
import { jarvisService } from '../services/jarvisService';
import { ttsService } from '../services/ttsService';
import { bleService } from '../services/bleService';

export type AppState =
  | 'idle'        // ждём команды
  | 'listening'   // слушаем голос
  | 'thinking'    // Claude обрабатывает
  | 'speaking'    // Jarvis отвечает
  | 'error';      // что-то пошло не так

interface JarvisState {
  appState: AppState;
  lastQuery: string;
  lastResponse: string;
  isGlassesConnected: boolean;
  error: string | null;
}

export const useJarvis = () => {
  const [state, setState] = useState<JarvisState>({
    appState: 'idle',
    lastQuery: '',
    lastResponse: 'Jarvis готов. Нажми и говори.',
    isGlassesConnected: false,
    error: null,
  });

  const setAppState = (appState: AppState) =>
    setState(prev => ({ ...prev, appState, error: null }));

  /**
   * Основной цикл: нажал кнопку → говоришь → Jarvis отвечает
   */
  const startVoiceInteraction = useCallback(async () => {
    if (state.appState !== 'idle') return;

    setAppState('listening');

    await voiceService.startListening(
      async (transcript) => {
        // Голос получен — отправляем в Claude
        setState(prev => ({ ...prev, lastQuery: transcript, appState: 'thinking' }));

        const response = await jarvisService.ask(transcript);

        setState(prev => ({ ...prev, lastResponse: response, appState: 'speaking' }));

        // Воспроизвести ответ (через очки или телефон)
        await ttsService.speak(response);

        setAppState('idle');
      },
      (error) => {
        setState(prev => ({ ...prev, error, appState: 'error' }));
        setTimeout(() => setAppState('idle'), 3000);
      }
    );
  }, [state.appState]);

  /**
   * Остановить прослушивание
   */
  const stopListening = useCallback(async () => {
    await voiceService.stopListening();
    setAppState('idle');
  }, []);

  /**
   * Подключить Ray-Ban очки
   */
  const connectGlasses = useCallback(async (): Promise<boolean> => {
    try {
      setState(prev => ({ ...prev, appState: 'idle', error: null }));

      await bleService.scanForGlasses(async (device) => {
        await bleService.connect(device.id);
        setState(prev => ({
          ...prev,
          isGlassesConnected: true,
          lastResponse: `Ray-Ban "${device.name}" подключены ✓`,
        }));
      });

      return true;
    } catch {
      setState(prev => ({
        ...prev,
        error: 'Очки не найдены. Убедись что они включены.',
      }));
      return false;
    }
  }, []);

  /**
   * Отключить очки
   */
  const disconnectGlasses = useCallback(async () => {
    await bleService.disconnect();
    setState(prev => ({ ...prev, isGlassesConnected: false }));
  }, []);

  // Cleanup при размонтировании
  useEffect(() => {
    return () => {
      voiceService.destroy();
      ttsService.stop();
    };
  }, []);

  return {
    ...state,
    startVoiceInteraction,
    stopListening,
    connectGlasses,
    disconnectGlasses,
  };
};
