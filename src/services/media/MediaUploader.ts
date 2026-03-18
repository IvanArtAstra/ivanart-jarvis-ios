/**
 * MediaUploader.ts — Upload media from glasses/phone to Jarvis server
 * 
 * Supports:
 *   - Photo upload (from SDK camera or phone gallery)
 *   - Audio upload (from SDK stream or phone mic)
 *   - Video upload (from SDK capture)
 *   - Upload + Vision AI analysis in one call
 *   - Offline queue: stores uploads when server unavailable, retries on reconnect
 * 
 * Server: jarvis_media_api.py (port 8768)
 */

import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MediaAsset } from '../glasses/GlassesProvider';

const STORAGE_KEY_MEDIA_URL = '@jarvis/media_api_url';
const MEDIA_URL_DEFAULT = 'http://192.168.0.39:8768';
const STORAGE_KEY_OFFLINE_QUEUE = '@jarvis/media_offline_queue';
const UPLOAD_TIMEOUT_MS = 60000;

export interface UploadResult {
  ok: boolean;
  mediaId: string;
  filename: string;
  sizeBytes: number;
  url: string;
  analysis?: string;
  model?: string;
  error?: string;
}

interface QueuedUpload {
  uri: string;
  mimeType: string;
  prompt?: string;
  addedAt: string;
}

export class MediaUploaderService {
  private baseUrl: string = MEDIA_URL_DEFAULT;
  private isAvailable: boolean = false;

  async init(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY_MEDIA_URL);
      if (saved) this.baseUrl = saved;
    } catch {}
    this.isAvailable = await this.healthCheck();
  }

  async setApiUrl(url: string): Promise<void> {
    this.baseUrl = url.replace(/\/$/, '');
    await AsyncStorage.setItem(STORAGE_KEY_MEDIA_URL, this.baseUrl);
    this.isAvailable = await this.healthCheck();
  }

  async getApiUrl(): Promise<string> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY_MEDIA_URL);
      return saved || MEDIA_URL_DEFAULT;
    } catch {
      return MEDIA_URL_DEFAULT;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ─── Upload Media ─────────────────────────────────────────────

  /**
   * Upload a media file to Jarvis server.
   * Accepts MediaAsset from glasses or a local file URI.
   */
  async uploadMedia(
    asset: MediaAsset | { uri: string; mimeType: string },
    sessionId: string = 'default',
    tags: string[] = [],
  ): Promise<UploadResult> {
    const { uri, mimeType } = asset;

    // Check server availability
    if (!this.isAvailable) {
      this.isAvailable = await this.healthCheck();
      if (!this.isAvailable) {
        // Queue for later
        await this.queueOfflineUpload(uri, mimeType);
        return {
          ok: false,
          mediaId: '',
          filename: '',
          sizeBytes: 0,
          url: '',
          error: 'Server offline — queued for later upload',
        };
      }
    }

    try {
      const formData = new FormData();

      // Read file and create blob-like object for React Native
      const fileInfo = await RNFS.stat(uri.replace('file://', ''));
      const filename = uri.split('/').pop() || 'media';

      formData.append('file', {
        uri: uri.startsWith('file://') ? uri : `file://${uri}`,
        type: mimeType,
        name: filename,
      } as any);

      formData.append('session_id', sessionId);
      formData.append('source', 'ios');
      formData.append('tags', tags.join(','));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

      const resp = await fetch(`${this.baseUrl}/api/media`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Upload failed: ${resp.status} ${err}`);
      }

      const data = await resp.json();
      console.info(`[MediaUploader] ✅ Uploaded: ${data.filename} (${data.size_bytes} bytes)`);

      this.isAvailable = true;
      return {
        ok: true,
        mediaId: data.media_id,
        filename: data.filename,
        sizeBytes: data.size_bytes,
        url: data.url,
      };
    } catch (e: any) {
      console.warn('[MediaUploader] Upload failed:', e.message);
      if (e.name === 'AbortError') {
        return { ok: false, mediaId: '', filename: '', sizeBytes: 0, url: '', error: 'Upload timeout' };
      }
      this.isAvailable = false;
      await this.queueOfflineUpload(uri, mimeType);
      return { ok: false, mediaId: '', filename: '', sizeBytes: 0, url: '', error: e.message };
    }
  }

  // ─── Upload + Analyze ─────────────────────────────────────────

  /**
   * Upload media and analyze with AI in one call.
   * For images: Claude Vision analysis.
   * For audio: Whisper transcription.
   */
  async uploadAndAnalyze(
    asset: MediaAsset | { uri: string; mimeType: string },
    prompt: string = 'Опиши что ты видишь на этом фото. Ответь кратко, 2-3 предложения.',
    sessionId: string = 'default',
    model?: string,
  ): Promise<string> {
    const { uri, mimeType } = asset;

    if (!this.isAvailable) {
      this.isAvailable = await this.healthCheck();
      if (!this.isAvailable) {
        throw new Error('Сервер медиа недоступен. Проверь подключение.');
      }
    }

    try {
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'media';

      formData.append('file', {
        uri: uri.startsWith('file://') ? uri : `file://${uri}`,
        type: mimeType,
        name: filename,
      } as any);

      formData.append('prompt', prompt);
      formData.append('session_id', sessionId);
      if (model) formData.append('model', model);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS * 2); // Longer for analysis

      const resp = await fetch(`${this.baseUrl}/api/media/analyze`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Analysis failed: ${resp.status} ${err}`);
      }

      const data = await resp.json();
      console.info(`[MediaUploader] 🔍 Analysis complete: ${data.analysis?.slice(0, 60)}...`);

      this.isAvailable = true;
      return data.analysis || '[No analysis returned]';
    } catch (e: any) {
      console.warn('[MediaUploader] Analysis failed:', e.message);
      if (e.name === 'AbortError') {
        throw new Error('Таймаут анализа — попробуй ещё раз');
      }
      throw e;
    }
  }

  // ─── Offline Queue ────────────────────────────────────────────

  private async queueOfflineUpload(uri: string, mimeType: string, prompt?: string): Promise<void> {
    try {
      const queue = await this.getOfflineQueue();
      queue.push({
        uri,
        mimeType,
        prompt,
        addedAt: new Date().toISOString(),
      });
      // Keep max 50 items
      const trimmed = queue.slice(-50);
      await AsyncStorage.setItem(STORAGE_KEY_OFFLINE_QUEUE, JSON.stringify(trimmed));
      console.info(`[MediaUploader] 📥 Queued for offline upload (${trimmed.length} in queue)`);
    } catch (e) {
      console.warn('[MediaUploader] Failed to queue:', e);
    }
  }

  async getOfflineQueue(): Promise<QueuedUpload[]> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_OFFLINE_QUEUE);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /**
   * Retry all queued uploads. Call when server becomes available.
   */
  async retryOfflineQueue(): Promise<number> {
    const queue = await this.getOfflineQueue();
    if (queue.length === 0) return 0;

    const available = await this.healthCheck();
    if (!available) return 0;

    let uploaded = 0;
    const remaining: QueuedUpload[] = [];

    for (const item of queue) {
      try {
        // Check file still exists
        const exists = await RNFS.exists(item.uri.replace('file://', ''));
        if (!exists) continue;

        if (item.prompt) {
          await this.uploadAndAnalyze(
            { uri: item.uri, mimeType: item.mimeType },
            item.prompt,
          );
        } else {
          await this.uploadMedia({ uri: item.uri, mimeType: item.mimeType });
        }
        uploaded++;
      } catch {
        remaining.push(item);
      }
    }

    await AsyncStorage.setItem(STORAGE_KEY_OFFLINE_QUEUE, JSON.stringify(remaining));
    console.info(`[MediaUploader] 🔄 Retried queue: ${uploaded} uploaded, ${remaining.length} remaining`);
    return uploaded;
  }

  // ─── List / Get ───────────────────────────────────────────────

  async listMedia(limit: number = 20): Promise<any[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/media?limit=${limit}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.items || [];
    } catch {
      return [];
    }
  }

  getMediaUrl(mediaId: string): string {
    return `${this.baseUrl}/api/media/${mediaId}`;
  }

  get available(): boolean {
    return this.isAvailable;
  }
}

export const mediaUploader = new MediaUploaderService();
