/**
 * AgentBridge Service — WebSocket клиент для iOS
 * Соединяет приложение с агент-системой workspace
 */

import { BACKEND_URL } from '../utils/config';

const WS_URL = BACKEND_URL.replace('http', 'ws').replace('8000', '8766');

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

  /**
   * Подключиться к Agent Bridge
   */
  connect(onStatusChange?: StatusHandler): void {
    this.onStatusChange = onStatusChange ?? null;
    this.doConnect();
  }

  private doConnect(): void {
    try {
      console.log('[Bridge] Connecting to:', WS_URL);
      this.ws = new WebSocket(WS_URL);

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

    // Вызвать обработчики по типу
    const handlers = this.messageHandlers.get(type) ?? [];
    handlers.forEach(h => h(data));

    // Общий обработчик
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
   * Отправить команду и получить ответ
   */
  async send(command: string, payload: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.isConnected) {
        reject(new Error('Agent Bridge не подключён'));
        return;
      }

      const message = { command, payload };
      this.ws.send(JSON.stringify(message));

      // Ждём ответ нужного типа
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

      // Таймаут 10 сек
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

  // ─── Высокоуровневые методы ───────────────────────────────────

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

  async addPost(title: string, caption: string): Promise<string> {
    const scheduled = new Date();
    scheduled.setHours(20, 0, 0, 0);
    const res = await this.send('add_post', {
      title,
      caption,
      scheduled_for: scheduled.toISOString(),
    });
    return res.data?.id ?? '';
  }

  async getTodayMemory(): Promise<string> {
    const res = await this.send('get_today_memory');
    return res.data?.content ?? '';
  }

  async getRecentResults(): Promise<any[]> {
    const res = await this.send('get_results', { limit: 5 });
    return res.data ?? [];
  }

  // ─── Event emitter ────────────────────────────────────────────

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

  get connected(): boolean {
    return this.isConnected;
  }
}

export const agentBridgeService = new AgentBridgeService();
