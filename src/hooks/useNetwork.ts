/**
 * useNetwork — React hook для реактивного состояния сети
 *
 * Использование:
 *   const { route, isOnline, routeType, serviceUrl, recheck } = useNetwork();
 */

import { useState, useEffect, useCallback } from 'react';
import NetworkService, {
  NetworkRoute,
  RouteType,
  ServiceName,
} from '../services/network/NetworkService';

export interface UseNetworkResult {
  /** Текущий маршрут */
  route: NetworkRoute;
  /** Тип маршрута */
  routeType: RouteType;
  /** Есть ли подключение */
  isOnline: boolean;
  /** Tailscale активен */
  isTailscale: boolean;
  /** Локальная сеть */
  isLocal: boolean;
  /** Latency до сервера (мс) */
  latencyMs: number | null;
  /** Получить URL сервиса */
  serviceUrl: (service: ServiceName) => string;
  /** Принудительная перепроверка */
  recheck: () => Promise<void>;
  /** Идёт проверка */
  isChecking: boolean;
}

export function useNetwork(): UseNetworkResult {
  const network = NetworkService.getInstance();

  const [route, setRoute] = useState<NetworkRoute>(network.currentRoute);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    // Подписываемся на изменения маршрута
    const unsubscribe = network.onRouteChange((newRoute) => {
      setRoute(newRoute);
    });

    // Начальное определение при монтировании
    setIsChecking(true);
    network.detectBestRoute().then((detected) => {
      setRoute(detected);
      setIsChecking(false);
    });

    return unsubscribe;
  }, []);

  const recheck = useCallback(async () => {
    setIsChecking(true);
    try {
      const detected = await network.forceRecheck();
      setRoute(detected);
    } finally {
      setIsChecking(false);
    }
  }, []);

  const serviceUrl = useCallback(
    (service: ServiceName) => network.getServiceUrl(service),
    [route],
  );

  return {
    route,
    routeType: route.type,
    isOnline: route.type !== 'offline',
    isTailscale: route.type === 'tailscale',
    isLocal: route.type === 'local',
    latencyMs: route.latencyMs,
    serviceUrl,
    recheck,
    isChecking,
  };
}

export default useNetwork;
