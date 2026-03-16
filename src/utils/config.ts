/**
 * Config — API ключи и настройки
 * ⚠️ В продакшне использовать .env через react-native-dotenv
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Anthropic Claude
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

// ElevenLabs TTS
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? '';

// Jarvis Voice ID (твой клонированный голос из CosyVoice или ElevenLabs)
export const JARVIS_VOICE_ID = process.env.JARVIS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB';

// ─── Backend URL — статический IP через bore.pub ─────────────────────────────
//
// Варианты подключения к Agent Bridge (порт 8766):
// 1. Домашняя сеть:  http://192.168.X.X:8766
// 2. bore.pub туннель (любая сеть): ws://<subdomain>.bore.pub:2200
// 3. Tailscale VPN (безопаснее):    http://100.70.68.84:8766
//
// Tailscale IP твоего сервера: 100.70.68.84
// Используй Tailscale — работает везде без открытых портов!

export const BACKEND_URL_DEFAULT = 'ws://100.70.68.84:8766';
export const BACKEND_URL_LOCAL   = 'ws://192.168.1.100:8766'; // обновить под свой IP

// Текущий URL — читается из AsyncStorage (можно менять в настройках)
const STORAGE_KEY_BACKEND = '@jarvis/backend_url';
const STORAGE_KEY_VOICE   = '@jarvis/voice_id';

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

// BLE
export const BLE_SCAN_TIMEOUT_MS    = 15000;
export const BLE_DEVICE_NAME_FILTER = 'ray-ban';


// ── Bridge URL ─────────────────────────────────────────────
const STORAGE_KEY_BRIDGE = '@jarvis/bridge_url';

export const BRIDGE_URL_DEFAULT = 'ws://100.70.68.84:8766';

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
