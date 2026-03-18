/**
 * NetworkService — автоопределение маршрута (Tailscale / LAN / Offline)
 *
 * При запуске пробует оба IP с таймаутом 2с, выбирает лучший маршрут
 * и автоматически конфигурирует URL всех сервисов.
 */

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import {
  TAILSCALE_IP,
  LOCAL_IP,
  SERVER_PORTS,
  getAutoDetect,
  setServerIp,
  getServerIp,
} from '../../utils/config';

// ── Типы ────────────────────────────────────────────────────

export type RouteType = 'tailscale' | 'local' | 'offline';

export type ServiceName = 'bridge' | 'api' | 'media' | 'audio' | 'push';

export interface NetworkRoute {
  type: RouteType;
  ip: string | null;
  latencyMs: number | null;
  detectedAt: Date;
}

type RouteChangeCallback = (route: NetworkRoute) => void;

// ── Константы ───────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 2000;
const RECHECK_COOLDOWN_MS = 5000; // Минимальный интервал между проверками

// Протоколы для каждого сервиса
const SERVICE_PROTOCOL: Record<ServiceName, 'ws' | 'http'> = {
  bridge: 'ws',
  api: 'http',
  media: 'http',
  audio: 'ws',
  push: 'http',
};

// ── Утилиты ─────────────────────────────────────────────────

/** Проверка доступности хоста с замером latency */
async function probeHost(ip: string, port: number, timeoutMs: number): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    // Пробуем HTTP health-check на API порт
    const response = await fetch(`http://${ip}:${port}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok || response.status === 404) {
      // 404 тоже ОК — значит сервер отвечает, просто нет /health
      return Date.now() - start;
    }
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ── NetworkService (Singleton) ──────────────────────────────

export class NetworkService {
  private static _instance: NetworkService | null = null;

  private _currentRoute: NetworkRoute = {
    type: 'offline',
    ip: null,
    latencyMs: null,
    detectedAt: new Date(),
  };

  private _listeners: Set<RouteChangeCallback> = new Set();
  private _netInfoUnsubscribe: (() => void) | null = null;
  private _lastCheckAt = 0;
  private _checking = false;

  private constructor() {}

  /** Singleton доступ */
  static getInstance(): NetworkService {
    if (!NetworkService._instance) {
      NetworkService._instance = new NetworkService();
    }
    return NetworkService._instance;
  }

  // ── Публичный API ──────────────────────────────────────

  /** Текущий маршрут */
  get currentRoute(): NetworkRoute {
    return { ...this._currentRoute };
  }

  /** Определить лучший маршрут */
  async detectBestRoute(): Promise<NetworkRoute> {
    // Защита от дублирования проверок
    if (this._checking) {
      return this._currentRoute;
    }

    const now = Date.now();
    if (now - this._lastCheckAt < RECHECK_COOLDOWN_MS) {
      return this._currentRoute;
    }

    this._checking = true;
    this._lastCheckAt = now;

    try {
      const autoDetect = await getAutoDetect();

      if (!autoDetect) {
        // Ручной режим — используем сохранённый IP
        const savedIp = await getServerIp();
        if (savedIp) {
          const latency = await probeHost(savedIp, SERVER_PORTS.api, PROBE_TIMEOUT_MS);
          this._setRoute({
            type: savedIp === TAILSCALE_IP ? 'tailscale' : 'local',
            ip: savedIp,
            latencyMs: latency,
            detectedAt: new Date(),
          });
        }
        return this._currentRoute;
      }

      // Параллельная проверка обоих маршрутов
      const [tailscaleLatency, localLatency] = await Promise.all([
        probeHost(TAILSCALE_IP, SERVER_PORTS.api, PROBE_TIMEOUT_MS),
        probeHost(LOCAL_IP, SERVER_PORTS.api, PROBE_TIMEOUT_MS),
      ]);

      let newRoute: NetworkRoute;

      if (localLatency !== null && tailscaleLatency !== null) {
        // Оба доступны — выбираем по latency (LAN обычно быстрее)
        if (localLatency <= tailscaleLatency) {
          newRoute = { type: 'local', ip: LOCAL_IP, latencyMs: localLatency, detectedAt: new Date() };
        } else {
          newRoute = { type: 'tailscale', ip: TAILSCALE_IP, latencyMs: tailscaleLatency, detectedAt: new Date() };
        }
      } else if (localLatency !== null) {
        newRoute = { type: 'local', ip: LOCAL_IP, latencyMs: localLatency, detectedAt: new Date() };
      } else if (tailscaleLatency !== null) {
        newRoute = { type: 'tailscale', ip: TAILSCALE_IP, latencyMs: tailscaleLatency, detectedAt: new Date() };
      } else {
        newRoute = { type: 'offline', ip: null, latencyMs: null, detectedAt: new Date() };
      }

      this._setRoute(newRoute);

      // Сохраняем выбранный IP
      if (newRoute.ip) {
        await setServerIp(newRoute.ip);
      }

      return this._currentRoute;
    } finally {
      this._checking = false;
    }
  }

  /** URL сервиса на основе текущего маршрута */
  getServiceUrl(service: ServiceName): string {
    const ip = this._currentRoute.ip;
    if (!ip) {
      // Offline fallback — вернём localhost (не подключится, но не упадёт)
      const fallbackIp = LOCAL_IP;
      const proto = SERVICE_PROTOCOL[service];
      const port = SERVER_PORTS[service];
      return `${proto}://${fallbackIp}:${port}`;
    }

    const proto = SERVICE_PROTOCOL[service];
    const port = SERVER_PORTS[service];
    return `${proto}://${ip}:${port}`;
  }

  /** Подписка на смену маршрута */
  onRouteChange(cb: RouteChangeCallback): () => void {
    this._listeners.add(cb);
    return () => {
      this._listeners.delete(cb);
    };
  }

  /** Запустить мониторинг сети (вызывать при старте приложения) */
  startMonitoring(): void {
    if (this._netInfoUnsubscribe) return;

    this._netInfoUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected) {
        // Сеть появилась/изменилась — перепроверяем маршрут
        this.detectBestRoute();
      } else {
        // Сеть пропала
        this._setRoute({
          type: 'offline',
          ip: null,
          latencyMs: null,
          detectedAt: new Date(),
        });
      }
    });
  }

  /** Остановить мониторинг */
  stopMonitoring(): void {
    if (this._netInfoUnsubscribe) {
      this._netInfoUnsubscribe();
      this._netInfoUnsubscribe = null;
    }
  }

  /** Принудительная перепроверка (сбрасывает cooldown) */
  async forceRecheck(): Promise<NetworkRoute> {
    this._lastCheckAt = 0;
    return this.detectBestRoute();
  }

  // ── Приватные методы ────────────────────────────────────

  private _setRoute(route: NetworkRoute): void {
    const prev = this._currentRoute;
    this._currentRoute = route;

    // Уведомляем только при реальной смене
    if (prev.type !== route.type || prev.ip !== route.ip) {
      this._listeners.forEach(cb => {
        try {
          cb(route);
        } catch (e) {
          console.warn('[NetworkService] Listener error:', e);
        }
      });
    }
  }
}

export default NetworkService.getInstance();
