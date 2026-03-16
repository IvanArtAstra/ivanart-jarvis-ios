/**
 * AgentBridgeService v2 — WebSocket клиент для iOS
 * Соединяет приложение с jarvis_ios_bridge.py (порт 8766)
 *
 * Протокол бриджа:
 *   Send:    { type: "message", text: "..." }
 *   Receive: { type: "response", text: "...", state: "speaking" }
 *            { type: "state", state: "thinking"|"idle" }
 *            { type: "connected", message: "...", bore_url: "..." }
 *            { type: "pong", ts: ..., clients: ..., queries: ... }
 */

import { getBridgeUrl, BRIDGE_URL_DEFAULT } from '../utils/config';

type MessageHandler = (data: any) => void;
type StatusHandler = (connected: boolean) => void;

export interface AgentTask {
  id: string;
  agent: string;
  title: string;
  priority: string;
  created_at: string;
}

export interface SystemStatus {
  pending_tasks: number;
  in_progress_tasks: number;
  done_tasks: number;
  orchestrator_last: string;
  timestamp: string;
}

export class AgentBridgeService {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private onStatusChange: StatusHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;
  private pendingRequests: Map<string, (data: any) => void> = new Map();
  private reqIdCounter = 0;
  private currentUrl: string = BRIDGE_URL_DEFAULT;

  /**
   * Подключиться к Jarvis Bridge
   * Загружает URL из AsyncStorage (настройки)
   */
  async connect(onStatusChange?: StatusHandler): Promise<void> {
    this.onStatusChange = onStatusChange ?? null;
    // Load saved bridge URL from settings
    try {
      this.currentUrl = await getBridgeUrl();
    } catch {
      this.currentUrl = BRIDGE_URL_DEFAULT;
    }
    this.doConnect();
  }

  private doConnect(): void {
    try {
      console.log('[Bridge] Connecting to:', this.currentUrl);
      this.ws = new WebSocket(this.currentUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('[Bridge] ✅ Connected');
        this.onStatusChange?.(true);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('[Bridge] Parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('[Bridge] Disconnected — reconnecting in 5s');
        this.onStatusChange?.(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[Bridge] WS error:', error);
      };

    } catch (e) {
      console.error('[Bridge] Connection failed:', e);
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: any): void {
    const type = data.type as string;

    // Route to type-specific handlers
    const handlers = this.messageHandlers.get(type) ?? [];
    handlers.forEach(h => h(data));

    // Wildcard handlers
    const allHandlers = this.messageHandlers.get('*') ?? [];
    allHandlers.forEach(h => h(data));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, 5000);
  }

  /**
   * Отправить текст в Jarvis Bridge
   * Использует протокол jarvis_ios_bridge.py: { type, text }
   */
  sendToJarvis(text: string): void {
    if (!this.ws || !this.isConnected) {
      console.warn('[Bridge] Not connected — cannot send message');
      return;
    }
    const message = { type: 'message', text };
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Голосовой ввод — отдельный тип для аналитики на бридже
   */
  sendVoiceToJarvis(text: string): void {
    if (!this.ws || !this.isConnected) {
      console.warn('[Bridge] Not connected — cannot send voice');
      return;
    }
    this.ws.send(JSON.stringify({ type: 'voice', text }));
  }

  /**
   * Пинг бриджа
   */
  ping(): void {
    if (!this.ws || !this.isConnected) return;
    this.ws.send(JSON.stringify({ type: 'ping' }));
  }

  /**
   * Очистить историю диалога на стороне бриджа
   */
  clearHistory(): void {
    if (!this.ws || !this.isConnected) return;
    this.ws.send(JSON.stringify({ type: 'clear_history' }));
  }

  /**
   * Получить статус бриджа
   */
  getStatus(): void {
    if (!this.ws || !this.isConnected) return;
    this.ws.send(JSON.stringify({ type: 'get_status' }));
  }

  /**
   * Legacy метод для совместимости с Agent Backend (порт 8000)
   * Использует старый протокол { command, payload }
   */
  async send(command: string, payload: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.isConnected) {
        reject(new Error('Agent Bridge не подключён'));
        return;
      }

      const message = { command, payload };
      this.ws.send(JSON.stringify(message));

      const responseType = this.getResponseType(command);
      const handler: MessageHandler = (data) => {
        if (data.type === responseType || data.type === 'error') {
          this.off(responseType, handler);
          this.off('error', handler);
          if (data.type === 'error') reject(new Error(data.message));
          else resolve(data);
        }
      };

      this.on(responseType, handler);
      this.on('error', handler);

      setTimeout(() => {
        this.off(responseType, handler);
        reject(new Error('Timeout'));
      }, 10000);
    });
  }

  private getResponseType(command: string): string {
    const map: Record<string, string> = {
      system_status: 'system_status',
      get_tasks: 'tasks_list',
      dispatch_task: 'task_dispatched',
      add_post: 'post_added',
      get_results: 'results_list',
      get_today_memory: 'today_memory',
      ping: 'pong',
    };
    return map[command] ?? command;
  }

  // ─── High-level agent methods ──────────────────────────────

  async getSystemStatus(): Promise<SystemStatus> {
    const res = await this.send('system_status');
    return res.data;
  }

  async getTasks(): Promise<AgentTask[]> {
    const res = await this.send('get_tasks');
    return res.data;
  }

  async dispatchTask(agent: string, task: string, subject?: string): Promise<string> {
    const res = await this.send('dispatch_task', { agent, task, subject });
    return res.data?.message ?? 'Отправлено';
  }

  async getTodayMemory(): Promise<string> {
    const res = await this.send('get_today_memory');
    return res.data?.content ?? '';
  }

  // ─── Event emitter ─────────────────────────────────────────

  on(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type) ?? [];
    handlers.push(handler);
    this.messageHandlers.set(type, handlers);
  }

  off(type: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(type) ?? [];
    this.messageHandlers.set(type, handlers.filter(h => h !== handler));
  }

  onAgentResult(handler: MessageHandler): void {
    this.on('agent_result', handler);
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }

  /**
   * Переподключиться с новым URL (вызывать после смены Bridge URL в настройках)
   */
  async reconnectWithNewUrl(): Promise<void> {
    this.disconnect();
    await this.connect(this.onStatusChange ?? undefined);
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

export const agentBridgeService = new AgentBridgeService();
