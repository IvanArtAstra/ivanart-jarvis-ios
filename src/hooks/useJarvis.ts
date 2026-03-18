/**
 * useJarvis v3 — unified with glasses provider layer
 *
 * Replaces direct bleService calls with connectionManager.
 * Supports BLE + SDK modes with auto-fallback.
 *
 * Режимы:
 * - MANUAL: нажал кнопку → говоришь
 * - ALWAYS_ON: всегда слушает "Джарвис" → активируется
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { voiceService } from '../services/voiceService';
import { jarvisService } from '../services/jarvisService';
import { ttsService } from '../services/ttsService';
import { wakeWordService } from '../services/wakeWordService';
import { backgroundService } from '../services/backgroundService';
import { notificationService } from '../services/notificationService';
import { agentBridgeService } from '../services/agentBridgeService';
import { commandParserService } from '../services/commandParserService';
import { connectionManager, ConnectionStatus, MediaAsset } from '../services/glasses';

export type AppState =
  | 'idle'          // ждём
  | 'wake_listen'   // фоновое прослушивание (wake word)
  | 'listening'     // активно слушаем запрос
  | 'thinking'      // Claude обрабатывает
  | 'speaking'      // Jarvis отвечает
  | 'capturing'     // камера: снимает фото/видео
  | 'error';

export type ListenMode = 'manual' | 'always_on';

interface JarvisState {
  appState: AppState;
  listenMode: ListenMode;
  lastQuery: string;
  lastResponse: string;
  partialText: string;
  isGlassesConnected: boolean;
  isBridgeConnected: boolean;
  glassesProvider: 'ble' | 'sdk' | 'none';
  error: string | null;
  sessionCount: number;
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
    glassesProvider: 'none',
    error: null,
    sessionCount: 0,
  });

  const isProcessingRef = useRef(false);

  const update = (patch: Partial<JarvisState>) =>
    setState(prev => ({ ...prev, ...patch }));

  // ─── Initialize glasses provider ────────────────────────────
  useEffect(() => {
    connectionManager.initialize().then(() => {
      const status = connectionManager.getStatus();
      update({
        isGlassesConnected: connectionManager.isConnected,
        glassesProvider: status.activeProvider,
      });
    });

    // Listen for status changes
    connectionManager.onStatusChange((status: ConnectionStatus) => {
      update({
        isGlassesConnected: status.activeProvider !== 'none',
        glassesProvider: status.activeProvider,
      });
    });

    // Set up glasses event handlers
    connectionManager.setEventHandlers({
      onVoiceCommand: (commandId: string) => {
        handleVoiceCommand(commandId);
      },
      onMessage: (text: string) => {
        // BLE message from glasses → treat as user query
        if (text.trim()) {
          processQuery(text.trim());
        }
      },
      onMediaCaptured: (asset: MediaAsset) => {
        // Photo/video auto-captured → analyze with Vision
        handleMediaCaptured(asset);
      },
      onGesture: (gesture) => {
        // Tap → "что я вижу", double tap → "переведи"
        if (gesture.type === 'tap') {
          captureAndAnalyze();
        } else if (gesture.type === 'double_tap') {
          captureAndTranslate();
        }
      },
    });
  }, []);

  // ─── Voice command handler (SDK) ────────────────────────────
  const handleVoiceCommand = useCallback((commandId: string) => {
    switch (commandId) {
      case 'jarvis_listen':
        startVoiceInteraction();
        break;
      case 'jarvis_photo':
        captureAndAnalyze();
        break;
      case 'jarvis_translate':
        captureAndTranslate();
        break;
      case 'jarvis_remember':
        captureAndRemember();
        break;
      case 'jarvis_status':
        processQuery('Джарвис, статус системы');
        break;
      case 'jarvis_tasks':
        processQuery('Джарвис, сколько задач в очереди');
        break;
      case 'jarvis_stop':
        stopListening();
        break;
    }
  }, []);

  // ─── Media capture handlers ─────────────────────────────────
  const handleMediaCaptured = useCallback(async (asset: MediaAsset) => {
    update({ appState: 'thinking' });
    try {
      // Upload to server and analyze with Vision AI
      const { mediaUploader } = require('../services/media/MediaUploader');
      const uploadResult = await mediaUploader.uploadMedia(asset);

      if (uploadResult?.analysis) {
        update({ lastResponse: uploadResult.analysis, appState: 'speaking' });
        await sendResponseToGlasses(uploadResult.analysis);
        await ttsService.speak(uploadResult.analysis);
      }
    } catch (e: any) {
      update({ error: e.message, appState: 'error' });
    }
    update({ appState: state.listenMode === 'always_on' ? 'wake_listen' : 'idle' });
  }, [state.listenMode]);

  const captureAndAnalyze = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    update({ appState: 'capturing' });
    try {
      const photo = await connectionManager.capturePhoto();
      const { mediaUploader } = require('../services/media/MediaUploader');
      const result = await mediaUploader.uploadAndAnalyze(photo, 'Опиши что ты видишь на этом фото. Ответь кратко, 2-3 предложения.');

      update({ lastResponse: result, appState: 'speaking', lastQuery: '📷 Что я вижу?' });
      await sendResponseToGlasses(result);
      await ttsService.speak(result);
    } catch (e: any) {
      const msg = e.name === 'UnsupportedCapabilityError'
        ? 'Камера доступна только через Meta SDK. Переключи режим в настройках.'
        : `Ошибка камеры: ${e.message}`;
      update({ error: msg, appState: 'error' });
      await ttsService.speak(msg);
    }
    isProcessingRef.current = false;
    update({ appState: state.listenMode === 'always_on' ? 'wake_listen' : 'idle' });
  }, [state.listenMode]);

  const captureAndTranslate = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    update({ appState: 'capturing' });
    try {
      const photo = await connectionManager.capturePhoto();
      const { mediaUploader } = require('../services/media/MediaUploader');
      const result = await mediaUploader.uploadAndAnalyze(photo, 'Найди текст на фото и переведи его на русский. Если текст уже на русском — переведи на английский.');

      update({ lastResponse: result, appState: 'speaking', lastQuery: '🌐 Переведи' });
      await sendResponseToGlasses(result);
      await ttsService.speak(result);
    } catch (e: any) {
      update({ error: e.message, appState: 'error' });
    }
    isProcessingRef.current = false;
    update({ appState: state.listenMode === 'always_on' ? 'wake_listen' : 'idle' });
  }, [state.listenMode]);

  const captureAndRemember = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    update({ appState: 'capturing' });
    try {
      const photo = await connectionManager.capturePhoto();
      const { mediaUploader } = require('../services/media/MediaUploader');
      const result = await mediaUploader.uploadAndAnalyze(photo, 'Опиши что на фото и сохрани это как заметку. Подтверди что запомнил.');

      update({ lastResponse: result, appState: 'speaking', lastQuery: '💾 Запомни это' });
      await sendResponseToGlasses(result);
      await ttsService.speak(result);
    } catch (e: any) {
      update({ error: e.message, appState: 'error' });
    }
    isProcessingRef.current = false;
    update({ appState: state.listenMode === 'always_on' ? 'wake_listen' : 'idle' });
  }, [state.listenMode]);

  // ─── Send response to glasses (unified) ─────────────────────
  const sendResponseToGlasses = useCallback(async (text: string) => {
    if (!connectionManager.isConnected) return;

    try {
      if (connectionManager.activeProvider === 'sdk') {
        // SDK: show on display + TTS on glasses speakers
        await connectionManager.showOnDisplay({
          title: 'Jarvis',
          body: text,
          speakText: text,
          ledPattern: 'notification',
        });
      } else {
        // BLE: send as text
        await connectionManager.sendText(text);
      }
    } catch (e) {
      console.warn('[Jarvis] Send to glasses failed:', e);
    }
  }, []);

  // ─── Main query processing ──────────────────────────────────
  const processQuery = useCallback(async (transcript: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    update({ lastQuery: transcript, appState: 'thinking', partialText: '' });
    notificationService.hapticResponse();

    // Set LED to thinking
    try { await connectionManager.setLED('thinking'); } catch {}

    // Route: agent commands first, then Claude
    let response: string;
    const agentCmd = agentBridgeService.connected
      ? await commandParserService.parse(transcript)
      : null;

    if (agentCmd?.response) {
      response = agentCmd.response;
    } else {
      response = await jarvisService.ask(transcript);
    }

    update({
      lastResponse: response,
      appState: 'speaking',
      sessionCount: state.sessionCount + 1,
      error: null,
    });

    // Send to glasses
    await sendResponseToGlasses(response);

    // Play TTS
    await ttsService.speak(response);

    // Reset LED
    try { await connectionManager.setLED('idle'); } catch {}

    isProcessingRef.current = false;

    const nextState = state.listenMode === 'always_on' ? 'wake_listen' : 'idle';
    update({ appState: nextState });

    if (state.listenMode === 'always_on') {
      startWakeWordListening();
    }
  }, [state.listenMode, state.sessionCount]);

  // ─── Wake word ──────────────────────────────────────────────
  const handleWakeWordDetected = useCallback(async () => {
    if (isProcessingRef.current) return;

    notificationService.hapticWakeWord();
    await wakeWordService.stop();

    update({ appState: 'listening', partialText: '' });

    await voiceService.startListening(
      (transcript) => processQuery(transcript),
      (error) => {
        update({ error, appState: 'wake_listen' });
        startWakeWordListening();
      }
    );
  }, [processQuery]);

  const startWakeWordListening = useCallback(async () => {
    await wakeWordService.start(
      handleWakeWordDetected,
      (partial) => update({ partialText: partial })
    );
  }, [handleWakeWordDetected]);

  // ─── Mode switching ─────────────────────────────────────────
  const setListenMode = useCallback(async (mode: ListenMode) => {
    update({ listenMode: mode });

    if (mode === 'always_on') {
      await backgroundService.startKeepAlive();
      await startWakeWordListening();
      update({ appState: 'wake_listen', lastResponse: 'Слушаю в фоне... Скажи "Джарвис"' });
    } else {
      await wakeWordService.stop();
      await backgroundService.stopKeepAlive();
      update({ appState: 'idle', lastResponse: 'Нажми кнопку и говори.' });
    }
  }, [startWakeWordListening]);

  // ─── Manual mode — button ───────────────────────────────────
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

  // ─── Glasses connection (via ConnectionManager) ─────────────
  const connectGlasses = useCallback(async (): Promise<boolean> => {
    try {
      const ok = await connectionManager.scanAndConnect();
      if (ok) {
        const status = connectionManager.getStatus();
        const providerLabel = status.activeProvider === 'sdk' ? 'Meta SDK' : 'BLE';
        update({
          isGlassesConnected: true,
          glassesProvider: status.activeProvider,
          lastResponse: `Ray-Ban подключены через ${providerLabel} ✓`,
        });
      } else {
        update({ error: 'Очки не найдены. Убедись что они включены.' });
      }
      return ok;
    } catch (e: any) {
      update({ error: e.message });
      return false;
    }
  }, []);

  const disconnectGlasses = useCallback(async () => {
    await connectionManager.disconnect();
    update({ isGlassesConnected: false, glassesProvider: 'none' });
  }, []);

  // ─── Agent Bridge ───────────────────────────────────────────
  useEffect(() => {
    agentBridgeService.connect((connected) => {
      update({ isBridgeConnected: connected });
    });

    agentBridgeService.onAgentResult(async (data) => {
      const preview = data.data?.preview ?? '';
      const file = (data.data?.file ?? '') as string;
      const agent = file.split('_')[0];
      const msg = `${agent} завершил задачу. ${preview.slice(0, 80)}`;
      notificationService.hapticResponse();
      await sendResponseToGlasses(msg);
      await ttsService.speak(msg);
      update({ lastResponse: msg });
    });
  }, []);

  // ─── Cleanup ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      voiceService.destroy();
      wakeWordService.stop();
      backgroundService.stopKeepAlive();
      ttsService.stop();
      agentBridgeService.disconnect();
      // Don't destroy connectionManager — it's a singleton
    };
  }, []);

  return {
    ...state,
    startVoiceInteraction,
    stopListening,
    setListenMode,
    connectGlasses,
    disconnectGlasses,
    captureAndAnalyze,
    captureAndTranslate,
    captureAndRemember,
  };
};
