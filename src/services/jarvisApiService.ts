/**
 * JarvisApiService — HTTP client for Jarvis Internal API
 * iOS → POST http://<server>:8767/api/chat → Jarvis (Claude) → response
 *
 * No API keys in the app. Key lives on server only.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL_KEY = '@jarvis_api_url';
export const API_URL_DEFAULT = 'http://192.168.0.39:8767';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  session_id: string;
  model: string;
  timestamp: string;
}

export interface HealthResponse {
  status: string;
  jarvis: string;
  anthropic: string;
  openai: string;
}

class JarvisApiService {
  private baseUrl: string = API_URL_DEFAULT;
  private sessionId: string = this.generateSessionId();
  private isAvailable: boolean = false;

  private generateSessionId(): string {
    return 'ios-' + Math.random().toString(36).substring(2, 14);
  }

  async init(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem(API_URL_KEY);
      if (saved) this.baseUrl = saved;
    } catch {}
    // Check health on init
    this.isAvailable = await this.healthCheck();
  }

  async setApiUrl(url: string): Promise<void> {
    this.baseUrl = url.replace(/\/$/, '');
    await AsyncStorage.setItem(API_URL_KEY, this.baseUrl);
    this.isAvailable = await this.healthCheck();
  }

  async getApiUrl(): Promise<string> {
    try {
      const saved = await AsyncStorage.getItem(API_URL_KEY);
      return saved || API_URL_DEFAULT;
    } catch {
      return API_URL_DEFAULT;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return resp.ok;
    } catch {
      return false;
    }
  }

  async getServerInfo(): Promise<HealthResponse | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  async chat(text: string, onStateChange?: (state: 'thinking' | 'idle') => void): Promise<string> {
    onStateChange?.('thinking');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const resp = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          session_id: this.sessionId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`API error ${resp.status}: ${err}`);
      }

      const data: ChatResponse = await resp.json();
      this.isAvailable = true;
      return data.reply;
    } catch (e: any) {
      this.isAvailable = false;
      if (e.name === 'AbortError') throw new Error('Timeout — сервер не отвечает');
      throw e;
    } finally {
      onStateChange?.('idle');
    }
  }

  async clearSession(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/session/${this.sessionId}`, {
        method: 'DELETE',
      });
    } catch {}
    this.sessionId = this.generateSessionId();
  }

  get available(): boolean {
    return this.isAvailable;
  }

  get currentSessionId(): string {
    return this.sessionId;
  }

  get currentApiUrl(): string {
    return this.baseUrl;
  }
}

export const jarvisApi = new JarvisApiService();
