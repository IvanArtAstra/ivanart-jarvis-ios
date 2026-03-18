/**
 * useGlasses.ts — React hook for glasses connection state
 * 
 * Provides reactive access to ConnectionManager state,
 * mode switching, and connection actions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  connectionManager,
  ConnectionStatus,
  ConnectionMode,
  GlassesEventHandlers,
  GlassesInfo,
  MediaAsset,
  GestureEvent,
} from '../services/glasses';

export interface UseGlassesResult {
  // State
  status: ConnectionStatus;
  isConnected: boolean;
  activeProvider: 'ble' | 'sdk' | 'none';
  info: GlassesInfo | null;
  mode: ConnectionMode;
  isScanning: boolean;
  lastError: string | null;

  // Actions
  setMode: (mode: ConnectionMode) => Promise<void>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  sendText: (text: string) => Promise<void>;

  // SDK-only actions (check capabilities first)
  capturePhoto: () => Promise<MediaAsset | null>;
  showOnDisplay: (title: string, body: string, speak?: boolean) => Promise<void>;

  // Capability checks
  hasCamera: boolean;
  hasDisplay: boolean;
  hasAudioStream: boolean;
  hasGestures: boolean;
}

export function useGlasses(
  eventHandlers?: Partial<GlassesEventHandlers>,
): UseGlassesResult {
  const [status, setStatus] = useState<ConnectionStatus>(connectionManager.getStatus());
  const [isScanning, setIsScanning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const initialized = useRef(false);

  // Initialize connection manager once
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    connectionManager.initialize().then(() => {
      setStatus(connectionManager.getStatus());
    });

    // Listen for status changes
    connectionManager.onStatusChange((s) => setStatus(s));

    // Set up user event handlers
    if (eventHandlers) {
      connectionManager.setEventHandlers({
        onMessage: eventHandlers.onMessage,
        onGesture: eventHandlers.onGesture,
        onVoiceCommand: eventHandlers.onVoiceCommand,
        onMediaCaptured: eventHandlers.onMediaCaptured,
        onBatteryUpdate: eventHandlers.onBatteryUpdate,
        onError: (err) => {
          setLastError(err.message);
          eventHandlers.onError?.(err);
        },
        onStateChange: (state) => {
          setStatus(connectionManager.getStatus());
          eventHandlers.onStateChange?.(state);
        },
      });
    }

    return () => {
      // Don't destroy manager on unmount — it's a singleton
    };
  }, []);

  const setMode = useCallback(async (mode: ConnectionMode) => {
    setLastError(null);
    await connectionManager.setMode(mode);
    setStatus(connectionManager.getStatus());
  }, []);

  const connect = useCallback(async () => {
    setLastError(null);
    setIsScanning(true);
    try {
      const ok = await connectionManager.scanAndConnect();
      if (!ok) setLastError('Очки не найдены. Проверьте Bluetooth.');
      return ok;
    } catch (e: any) {
      setLastError(e.message);
      return false;
    } finally {
      setIsScanning(false);
      setStatus(connectionManager.getStatus());
    }
  }, []);

  const disconnect = useCallback(async () => {
    await connectionManager.disconnect();
    setStatus(connectionManager.getStatus());
  }, []);

  const sendText = useCallback(async (text: string) => {
    try {
      await connectionManager.sendText(text);
    } catch (e: any) {
      setLastError(e.message);
    }
  }, []);

  const capturePhoto = useCallback(async (): Promise<MediaAsset | null> => {
    try {
      return await connectionManager.capturePhoto();
    } catch (e: any) {
      setLastError(e.message);
      return null;
    }
  }, []);

  const showOnDisplay = useCallback(async (title: string, body: string, speak = true) => {
    try {
      await connectionManager.showOnDisplay({
        title,
        body,
        speakText: speak ? body : undefined,
      });
    } catch (e: any) {
      setLastError(e.message);
    }
  }, []);

  // Capability checks based on active provider
  const activeCapabilities = status.activeProvider === 'sdk'
    ? status.sdkCapabilities
    : status.activeProvider === 'ble'
      ? status.bleCapabilities
      : { camera: false, display: false, audioStream: false, gestures: false } as any;

  return {
    status,
    isConnected: connectionManager.isConnected,
    activeProvider: status.activeProvider,
    info: connectionManager.activeInfo,
    mode: status.mode,
    isScanning,
    lastError,

    setMode,
    connect,
    disconnect,
    sendText,
    capturePhoto,
    showOnDisplay,

    hasCamera: activeCapabilities.camera,
    hasDisplay: activeCapabilities.display,
    hasAudioStream: activeCapabilities.audioStream,
    hasGestures: activeCapabilities.gestures,
  };
}
