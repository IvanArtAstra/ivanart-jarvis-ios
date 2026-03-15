/**
 * Config — API ключи и настройки
 * ⚠️ В продакшне использовать .env через react-native-dotenv
 */

// Anthropic Claude
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

// ElevenLabs TTS
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? '';

// Jarvis Voice ID (твой клонированный голос из CosyVoice или ElevenLabs)
export const JARVIS_VOICE_ID = process.env.JARVIS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB'; // Adam (дефолт)

// Backend URL (твой локальный сервер или Heroku)
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000';

// BLE
export const BLE_SCAN_TIMEOUT_MS = 15000;
export const BLE_DEVICE_NAME_FILTER = 'ray-ban'; // фильтр при сканировании
