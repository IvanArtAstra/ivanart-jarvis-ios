/**
 * Config — API ключи, серверные адреса, авто-определение сети
 * ⚠️ В продакшне использовать .env через react-native-dotenv
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Anthropic Claude
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

// ElevenLabs TTS
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? '';

// Jarvis Voice ID (твой клонированный голос из CosyVoice или ElevenLabs)
export const JARVIS_VOICE_ID = process.env.JARVIS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB';

// ─── Серверные IP-адреса ─────────────────────────────────────

/** Tailscale VPN IP сервера */
export const TAILSCALE_IP = '100.70.68.84';

/** Локальный IP сервера в домашней сети */
export const LOCAL_IP = '192.168.0.39';

// ─── Порты сервисов ──────────────────────────────────────────

/** Порты всех backend-сервисов */
export const SERVER_PORTS = {
  bridge: 8766,   // jarvis_ios_bridge.py — WebSocket
  api: 8767,      // jarvis_api_server.py — REST API
  media: 8768,    // jarvis_media_api.py — медиа-файлы
  audio: 8769,    // audio streaming WebSocket
  push: 8770,     // jarvis_push_server.py — push-уведомления
} as const;

export type ServicePort = keyof typeof SERVER_PORTS;

// ─── Backend URL (legacy, для обратной совместимости) ─────────

export const BACKEND_URL_DEFAULT = `ws://${LOCAL_IP}:${SERVER_PORTS.bridge}`;
export const BACKEND_URL_LOCAL   = `ws://${LOCAL_IP}:${SERVER_PORTS.bridge}`;

// ─── AsyncStorage ключи ──────────────────────────────────────

const STORAGE_KEY_BACKEND    = '@jarvis/backend_url';
const STORAGE_KEY_VOICE      = '@jarvis/voice_id';
const STORAGE_KEY_SERVER_IP  = '@jarvis/server_ip';
const STORAGE_KEY_AUTODETECT = '@jarvis/auto_detect';

export async function getBackendUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_BACKEND);
    return saved ?? BACKEND_URL_DEFAULT;
  } catch {
    return BACKEND_URL_DEFAULT;
  }
}

export async function setBackendUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_BACKEND, url);
}

export async function getVoiceId(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_VOICE);
    return saved ?? JARVIS_VOICE_ID;
  } catch {
    return JARVIS_VOICE_ID;
  }
}

export async function setVoiceId(id: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_VOICE, id);
}

// ─── Server IP (авто-определение или ручной выбор) ───────────

export async function getServerIp(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEY_SERVER_IP);
  } catch {
    return null;
  }
}

export async function setServerIp(ip: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_SERVER_IP, ip);
}

// ─── Auto-Detection флаг ─────────────────────────────────────

export async function getAutoDetect(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_AUTODETECT);
    // По умолчанию включено
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export async function setAutoDetect(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_AUTODETECT, enabled ? 'true' : 'false');
}

// BLE
export const BLE_SCAN_TIMEOUT_MS    = 15000;
export const BLE_DEVICE_NAME_FILTER = 'ray-ban';

// ── Connection Mode ────────────────────────────────────────
// 'ble' | 'sdk' | 'auto'
const STORAGE_KEY_CONNECTION_MODE = '@jarvis/connection_mode';

export type ConnectionMode = 'ble' | 'sdk' | 'auto';

export async function getConnectionMode(): Promise<ConnectionMode> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_CONNECTION_MODE);
    if (saved && ['ble', 'sdk', 'auto'].includes(saved)) return saved as ConnectionMode;
    return 'auto';
  } catch {
    return 'auto';
  }
}

export async function setConnectionMode(mode: ConnectionMode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_CONNECTION_MODE, mode);
}


// ── Bridge URL ─────────────────────────────────────────────
const STORAGE_KEY_BRIDGE = '@jarvis/bridge_url';

export const BRIDGE_URL_DEFAULT = 'ws://192.168.0.39:8766';

export async function getBridgeUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_BRIDGE);
    return saved ?? BRIDGE_URL_DEFAULT;
  } catch {
    return BRIDGE_URL_DEFAULT;
  }
}

export async function setBridgeUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_BRIDGE, url);
}

// ── Audio Stream URL ───────────────────────────────────────
const STORAGE_KEY_AUDIO_STREAM = '@jarvis/audio_stream_url';

export const AUDIO_STREAM_URL_DEFAULT = 'ws://192.168.0.39:8769';

export async function getAudioStreamUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_AUDIO_STREAM);
    return saved ?? AUDIO_STREAM_URL_DEFAULT;
  } catch {
    return AUDIO_STREAM_URL_DEFAULT;
  }
}

export async function setAudioStreamUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_AUDIO_STREAM, url);
}
