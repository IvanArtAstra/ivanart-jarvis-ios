/**
 * ConnectionScreen.tsx — Диагностика подключений Jarvis
 * 
 * Визуальная цепочка: 🕶️ Очки ──► 📱 iPhone ──► 🖥️ Сервер
 * Секции: Ray-Ban Meta, Bridge, Media Server, API Server
 * Тестовые кнопки + лог событий в реальном времени
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Dimensions, Platform,
} from 'react-native';
import { useGlasses } from '../hooks/useGlasses';
import { jarvisApi } from '../services/jarvisApiService';
import { mediaUploader } from '../services/media/MediaUploader';
import { getBackendUrl, getBridgeUrl } from '../utils/config';

// ─── Тема HUD ────────────────────────────────────────────────

const CYAN     = '#00C2FF';
const DARK_BG  = '#040810';
const CARD_BG  = 'rgba(10,14,26,0.95)';
const BORDER   = 'rgba(0,194,255,0.12)';
const GREEN    = '#00FF88';
const RED      = '#FF4444';
const YELLOW   = '#FFAA00';
const MUTED    = 'rgba(255,255,255,0.4)';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Типы ─────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'error' | 'warn';
  message: string;
}

interface ServerStatus {
  online: boolean;
  latencyMs: number | null;
  info?: Record<string, any>;
  error?: string;
}

type ChainNodeStatus = 'connected' | 'disconnected' | 'checking' | 'partial';

// ─── Хелпер: измерение пинга ─────────────────────────────────

async function measurePing(url: string, path: string = '/health'): Promise<{ ok: boolean; ms: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${url}${path}`, { signal: controller.signal });
    clearTimeout(timeout);
    return { ok: resp.ok, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

// ─── Компонент: Визуальная цепочка подключений ────────────────

const ConnectionChain: React.FC<{
  glassesStatus: ChainNodeStatus;
  phoneStatus: ChainNodeStatus;
  serverStatus: ChainNodeStatus;
}> = ({ glassesStatus, phoneStatus, serverStatus }) => {
  const getColor = (s: ChainNodeStatus) => {
    switch (s) {
      case 'connected':    return GREEN;
      case 'disconnected': return RED;
      case 'checking':     return YELLOW;
      case 'partial':      return YELLOW;
    }
  };

  const getLabel = (s: ChainNodeStatus) => {
    switch (s) {
      case 'connected':    return '✅ Онлайн';
      case 'disconnected': return '❌ Офлайн';
      case 'checking':     return '⏳ Проверка';
      case 'partial':      return '⚠️ Частично';
    }
  };

  return (
    <View style={styles.chainContainer}>
      {/* Очки */}
      <View style={styles.chainNode}>
        <Text style={styles.chainEmoji}>🕶️</Text>
        <Text style={styles.chainLabel}>Очки</Text>
        <View style={[styles.chainDot, { backgroundColor: getColor(glassesStatus) }]} />
        <Text style={[styles.chainStatus, { color: getColor(glassesStatus) }]}>
          {getLabel(glassesStatus)}
        </Text>
      </View>

      {/* Стрелка */}
      <View style={styles.chainArrow}>
        <Text style={[
          styles.chainArrowText,
          { color: glassesStatus === 'connected' ? CYAN : MUTED },
        ]}>──►</Text>
      </View>

      {/* iPhone */}
      <View style={styles.chainNode}>
        <Text style={styles.chainEmoji}>📱</Text>
        <Text style={styles.chainLabel}>iPhone</Text>
        <View style={[styles.chainDot, { backgroundColor: getColor(phoneStatus) }]} />
        <Text style={[styles.chainStatus, { color: getColor(phoneStatus) }]}>
          {getLabel(phoneStatus)}
        </Text>
      </View>

      {/* Стрелка */}
      <View style={styles.chainArrow}>
        <Text style={[
          styles.chainArrowText,
          { color: phoneStatus === 'connected' ? CYAN : MUTED },
        ]}>──►</Text>
      </View>

      {/* Сервер */}
      <View style={styles.chainNode}>
        <Text style={styles.chainEmoji}>🖥️</Text>
        <Text style={styles.chainLabel}>Сервер</Text>
        <View style={[styles.chainDot, { backgroundColor: getColor(serverStatus) }]} />
        <Text style={[styles.chainStatus, { color: getColor(serverStatus) }]}>
          {getLabel(serverStatus)}
        </Text>
      </View>
    </View>
  );
};

// ─── Компонент: Карточка секции ───────────────────────────────

const SectionCard: React.FC<{
  title: string;
  icon: string;
  online: boolean | null;
  children: React.ReactNode;
}> = ({ title, icon, online, children }) => (
  <View style={styles.sectionCard}>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionIcon}>{icon}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={[
        styles.sectionStatusBadge,
        {
          backgroundColor: online === null
            ? 'rgba(255,170,0,0.15)'
            : online
              ? 'rgba(0,255,136,0.15)'
              : 'rgba(255,68,68,0.15)',
        },
      ]}>
        <View style={[
          styles.sectionStatusDot,
          {
            backgroundColor: online === null ? YELLOW : online ? GREEN : RED,
          },
        ]} />
        <Text style={[
          styles.sectionStatusText,
          { color: online === null ? YELLOW : online ? GREEN : RED },
        ]}>
          {online === null ? 'Проверка...' : online ? 'Online' : 'Offline'}
        </Text>
      </View>
    </View>
    <View style={styles.sectionBody}>
      {children}
    </View>
  </View>
);

// ─── Компонент: строка данных ─────────────────────────────────

const InfoRow: React.FC<{ label: string; value: string; color?: string }> = ({
  label, value, color,
}) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={[styles.infoValue, color ? { color } : null]}>{value}</Text>
  </View>
);

// ─── Компонент: кнопка теста ──────────────────────────────────

const TestButton: React.FC<{
  label: string;
  onPress: () => void;
  loading?: boolean;
  color?: string;
}> = ({ label, onPress, loading, color = CYAN }) => (
  <TouchableOpacity
    style={[styles.testBtn, { borderColor: color }, loading && { opacity: 0.5 }]}
    onPress={onPress}
    disabled={loading}
  >
    <Text style={[styles.testBtnText, { color }]}>
      {loading ? '⏳' : '▶'} {label}
    </Text>
  </TouchableOpacity>
);

// ─── Главный компонент ────────────────────────────────────────

export function ConnectionScreen() {
  const glasses = useGlasses();

  // Статусы серверов
  const [bridgeStatus, setBridgeStatus] = useState<ServerStatus>({
    online: false, latencyMs: null,
  });
  const [mediaStatus, setMediaStatus] = useState<ServerStatus>({
    online: false, latencyMs: null,
  });
  const [apiStatus, setApiStatus] = useState<ServerStatus>({
    online: false, latencyMs: null,
  });

  // URL серверов
  const [bridgeUrl, setBridgeUrlState] = useState<string>('');
  const [mediaUrl, setMediaUrlState]   = useState<string>('');
  const [apiUrl, setApiUrlState]       = useState<string>('');

  // Лог событий
  const [logs, setLogs]         = useState<LogEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [testRunning, setTestRunning]   = useState<string | null>(null);
  const logScrollRef = useRef<ScrollView>(null);

  // ─── Логирование ────────────────────────────────────────────

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs(prev => {
      const entry: LogEntry = {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        timestamp: Date.now(),
        level,
        message,
      };
      const updated = [...prev, entry].slice(-50); // максимум 50 записей
      return updated;
    });
    setTimeout(() => logScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // ─── Загрузка URL-ов ───────────────────────────────────────

  useEffect(() => {
    loadUrls();
    checkAllServers();
  }, []);

  const loadUrls = async () => {
    const bridge = await getBridgeUrl();
    const media  = await mediaUploader.getApiUrl();
    const api    = await jarvisApi.getApiUrl();
    setBridgeUrlState(bridge);
    setMediaUrlState(media);
    setApiUrlState(api);
  };

  // ─── Проверка серверов ──────────────────────────────────────

  const checkAllServers = async () => {
    addLog('info', '🔄 Проверка всех подключений...');

    // Bridge (WebSocket → проверяем HTTP вариант, или просто статус)
    await checkBridge();
    await checkMediaServer();
    await checkApiServer();

    addLog('info', '✅ Проверка завершена');
  };

  const checkBridge = async () => {
    const url = await getBridgeUrl();
    // Bridge — WebSocket сервер, пингуем HTTP часть если есть
    const httpUrl = url.replace('ws://', 'http://').replace('wss://', 'https://');
    const result = await measurePing(httpUrl);
    setBridgeStatus({
      online: result.ok,
      latencyMs: result.ms,
    });
    addLog(
      result.ok ? 'success' : 'error',
      `Bridge: ${result.ok ? `✅ ${result.ms}ms` : `❌ Недоступен (${result.ms}ms)`}`,
    );
  };

  const checkMediaServer = async () => {
    const url = await mediaUploader.getApiUrl();
    const result = await measurePing(url);
    setMediaStatus({
      online: result.ok,
      latencyMs: result.ms,
    });

    // Получить доп. информацию
    if (result.ok) {
      try {
        const items = await mediaUploader.listMedia(1);
        setMediaStatus(prev => ({
          ...prev,
          info: { fileCount: items.length },
        }));
      } catch {}
    }

    addLog(
      result.ok ? 'success' : 'error',
      `Media: ${result.ok ? `✅ ${result.ms}ms` : `❌ Недоступен (${result.ms}ms)`}`,
    );
  };

  const checkApiServer = async () => {
    const url = await jarvisApi.getApiUrl();
    const start = Date.now();
    const ok = await jarvisApi.healthCheck();
    const ms = Date.now() - start;

    let info: Record<string, any> | undefined;
    if (ok) {
      const serverInfo = await jarvisApi.getServerInfo();
      if (serverInfo) info = serverInfo;
    }

    setApiStatus({ online: ok, latencyMs: ms, info });
    addLog(
      ok ? 'success' : 'error',
      `API: ${ok ? `✅ ${ms}ms` : `❌ Недоступен (${ms}ms)`}`,
    );
  };

  // ─── Тестовые кнопки ────────────────────────────────────────

  const testBLE = async () => {
    setTestRunning('ble');
    addLog('info', '🔵 Тест BLE подключения...');
    try {
      const ok = await glasses.connect();
      addLog(ok ? 'success' : 'error', ok
        ? '✅ BLE: подключено к очкам'
        : '❌ BLE: очки не найдены');
    } catch (e: any) {
      addLog('error', `❌ BLE: ${e.message}`);
    }
    setTestRunning(null);
  };

  const testSDK = async () => {
    setTestRunning('sdk');
    addLog('info', '📡 Тест Meta SDK...');
    try {
      await glasses.setMode('sdk');
      const ok = await glasses.connect();
      addLog(ok ? 'success' : 'error', ok
        ? '✅ SDK: подключено'
        : '❌ SDK: недоступно');
    } catch (e: any) {
      addLog('error', `❌ SDK: ${e.message}`);
    }
    setTestRunning(null);
  };

  const testBridge = async () => {
    setTestRunning('bridge');
    addLog('info', '🌐 Тест Bridge Server...');
    await checkBridge();
    setTestRunning(null);
  };

  const testMedia = async () => {
    setTestRunning('media');
    addLog('info', '📸 Тест Media Server...');
    await checkMediaServer();
    setTestRunning(null);
  };

  const testFullChain = async () => {
    setTestRunning('full');
    addLog('info', '🔗 Полный тест цепочки...');

    // 1. Очки
    addLog('info', '  [1/4] Проверка очков...');
    const glassesOk = glasses.isConnected;
    addLog(glassesOk ? 'success' : 'warn',
      `  Очки: ${glassesOk ? '✅ Подключены' : '⚠️ Не подключены'}`);

    // 2. Bridge
    addLog('info', '  [2/4] Проверка Bridge...');
    await checkBridge();

    // 3. Media
    addLog('info', '  [3/4] Проверка Media Server...');
    await checkMediaServer();

    // 4. API
    addLog('info', '  [4/4] Проверка API...');
    await checkApiServer();

    const allOk = glassesOk && bridgeStatus.online && mediaStatus.online && apiStatus.online;
    addLog(
      allOk ? 'success' : 'warn',
      allOk
        ? '🎉 Полная цепочка работает!'
        : '⚠️ Некоторые компоненты недоступны',
    );
    setTestRunning(null);
  };

  // ─── Pull-to-refresh ────────────────────────────────────────

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadUrls();
    await checkAllServers();
    setIsRefreshing(false);
  };

  // ─── Статусы цепочки ───────────────────────────────────────

  const glassesChainStatus: ChainNodeStatus = glasses.isConnected
    ? 'connected'
    : glasses.isScanning ? 'checking' : 'disconnected';

  const phoneChainStatus: ChainNodeStatus = 'connected'; // Телефон всегда "подключён" (мы на нём)

  const serverChainStatus: ChainNodeStatus =
    apiStatus.online && mediaStatus.online
      ? 'connected'
      : apiStatus.online || mediaStatus.online
        ? 'partial'
        : apiStatus.latencyMs === null
          ? 'checking'
          : 'disconnected';

  // ─── Рендер ─────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Шапка */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🔌 Диагностика</Text>
        <Text style={styles.headerSubtitle}>Цепочка подключений Jarvis</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={CYAN}
            colors={[CYAN]}
            progressBackgroundColor={DARK_BG}
          />
        }
      >
        {/* Визуальная цепочка */}
        <ConnectionChain
          glassesStatus={glassesChainStatus}
          phoneStatus={phoneChainStatus}
          serverStatus={serverChainStatus}
        />

        {/* ─── Секция: Ray-Ban Meta ─────────────────────── */}
        <SectionCard
          title="Ray-Ban Meta"
          icon="🕶️"
          online={glasses.isConnected}
        >
          <InfoRow
            label="Провайдер"
            value={glasses.activeProvider === 'none'
              ? 'Не подключён'
              : glasses.activeProvider.toUpperCase()}
            color={glasses.isConnected ? CYAN : MUTED}
          />
          <InfoRow
            label="Режим"
            value={glasses.mode.toUpperCase()}
          />
          {glasses.info && (
            <>
              <InfoRow label="Устройство" value={glasses.info.name || '—'} />
              <InfoRow
                label="Батарея"
                value={glasses.info.battery != null ? `${glasses.info.battery}%` : '—'}
                color={
                  glasses.info.battery != null
                    ? glasses.info.battery > 30 ? GREEN : glasses.info.battery > 10 ? YELLOW : RED
                    : MUTED
                }
              />
              {glasses.info.signalStrength != null && (
                <InfoRow label="Сигнал" value={`${glasses.info.signalStrength} dBm`} />
              )}
              {glasses.info.firmwareVersion && (
                <InfoRow label="Прошивка" value={glasses.info.firmwareVersion} />
              )}
            </>
          )}
          <InfoRow
            label="Камера"
            value={glasses.hasCamera ? '✅ Доступна' : '❌ Недоступна'}
            color={glasses.hasCamera ? GREEN : MUTED}
          />
          <InfoRow
            label="Микрофон"
            value={glasses.hasAudioStream ? '✅ Доступен' : '❌ Недоступен'}
            color={glasses.hasAudioStream ? GREEN : MUTED}
          />
          <InfoRow
            label="Жесты"
            value={glasses.hasGestures ? '✅ Активны' : '❌ Неактивны'}
            color={glasses.hasGestures ? GREEN : MUTED}
          />
        </SectionCard>

        {/* ─── Секция: Bridge Server ────────────────────── */}
        <SectionCard
          title="Bridge Server"
          icon="🌐"
          online={bridgeStatus.online}
        >
          <InfoRow label="URL" value={bridgeUrl || '—'} />
          <InfoRow
            label="Задержка"
            value={bridgeStatus.latencyMs != null ? `${bridgeStatus.latencyMs}ms` : '—'}
            color={
              bridgeStatus.latencyMs != null
                ? bridgeStatus.latencyMs < 100 ? GREEN
                  : bridgeStatus.latencyMs < 500 ? YELLOW
                  : RED
                : MUTED
            }
          />
          <InfoRow
            label="Состояние"
            value={bridgeStatus.online ? 'Подключён' : 'Отключён'}
            color={bridgeStatus.online ? GREEN : RED}
          />
        </SectionCard>

        {/* ─── Секция: Media Server ─────────────────────── */}
        <SectionCard
          title="Media Server"
          icon="📸"
          online={mediaStatus.online}
        >
          <InfoRow label="URL" value={mediaUrl || '—'} />
          <InfoRow
            label="Задержка"
            value={mediaStatus.latencyMs != null ? `${mediaStatus.latencyMs}ms` : '—'}
            color={
              mediaStatus.latencyMs != null
                ? mediaStatus.latencyMs < 100 ? GREEN
                  : mediaStatus.latencyMs < 500 ? YELLOW
                  : RED
                : MUTED
            }
          />
          {mediaStatus.info?.fileCount != null && (
            <InfoRow label="Файлов" value={String(mediaStatus.info.fileCount)} />
          )}
        </SectionCard>

        {/* ─── Секция: API Server ───────────────────────── */}
        <SectionCard
          title="API Server (Jarvis)"
          icon="🤖"
          online={apiStatus.online}
        >
          <InfoRow label="URL" value={apiUrl || '—'} />
          <InfoRow
            label="Задержка"
            value={apiStatus.latencyMs != null ? `${apiStatus.latencyMs}ms` : '—'}
            color={
              apiStatus.latencyMs != null
                ? apiStatus.latencyMs < 200 ? GREEN
                  : apiStatus.latencyMs < 1000 ? YELLOW
                  : RED
                : MUTED
            }
          />
          {apiStatus.info && (
            <>
              {apiStatus.info.model && (
                <InfoRow label="Модель" value={String(apiStatus.info.model)} color={CYAN} />
              )}
              {apiStatus.info.jarvis && (
                <InfoRow label="Jarvis" value={String(apiStatus.info.jarvis)} />
              )}
              {apiStatus.info.anthropic && (
                <InfoRow label="Anthropic" value={String(apiStatus.info.anthropic)} />
              )}
            </>
          )}
        </SectionCard>

        {/* ─── Тестовые кнопки ──────────────────────────── */}
        <View style={styles.testSection}>
          <Text style={styles.testSectionTitle}>🧪 Тесты</Text>
          <View style={styles.testBtnGrid}>
            <TestButton
              label="BLE"
              onPress={testBLE}
              loading={testRunning === 'ble'}
            />
            <TestButton
              label="SDK"
              onPress={testSDK}
              loading={testRunning === 'sdk'}
            />
            <TestButton
              label="Bridge"
              onPress={testBridge}
              loading={testRunning === 'bridge'}
            />
            <TestButton
              label="Media"
              onPress={testMedia}
              loading={testRunning === 'media'}
            />
          </View>
          <TestButton
            label="Полный тест цепочки"
            onPress={testFullChain}
            loading={testRunning === 'full'}
            color={GREEN}
          />
        </View>

        {/* ─── Лог событий ──────────────────────────────── */}
        <View style={styles.logSection}>
          <View style={styles.logHeader}>
            <Text style={styles.logTitle}>📋 Лог событий</Text>
            <TouchableOpacity onPress={() => setLogs([])}>
              <Text style={styles.logClear}>Очистить</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            ref={logScrollRef}
            style={styles.logScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            {logs.length === 0 && (
              <Text style={styles.logEmpty}>Нет событий. Запусти тест.</Text>
            )}
            {logs.map(entry => (
              <View key={entry.id} style={styles.logEntry}>
                <Text style={styles.logTimestamp}>
                  {new Date(entry.timestamp).toLocaleTimeString('ru', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </Text>
                <Text style={[
                  styles.logMessage,
                  entry.level === 'success' && { color: GREEN },
                  entry.level === 'error'   && { color: RED },
                  entry.level === 'warn'    && { color: YELLOW },
                  entry.level === 'info'    && { color: MUTED },
                ]}>
                  {entry.message}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Отступ снизу */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

export default ConnectionScreen;

// ─── Стили ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  // Шапка
  header: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD_BG,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },

  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 16,
  },

  // Цепочка подключений
  chainContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingVertical: 16,
    paddingHorizontal: 8,
    marginBottom: 12,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chainNode: {
    alignItems: 'center',
    flex: 1,
  },
  chainEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  chainLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  chainDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  chainStatus: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  chainArrow: {
    justifyContent: 'center',
    paddingTop: 10,
  },
  chainArrowText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Карточки секций
  sectionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: 8,
  },
  sectionIcon: {
    fontSize: 18,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  sectionStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  sectionStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sectionStatusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sectionBody: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  // Строка данных
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  infoLabel: {
    color: MUTED,
    fontSize: 13,
  },
  infoValue: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },

  // Тесты
  testSection: {
    marginBottom: 12,
  },
  testSectionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  testBtnGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  testBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(0,194,255,0.06)',
    minWidth: (SCREEN_WIDTH - 48) / 2 - 4,
    alignItems: 'center',
  },
  testBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Лог
  logSection: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  logTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  logClear: {
    color: MUTED,
    fontSize: 12,
  },
  logScroll: {
    maxHeight: 250,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  logEmpty: {
    color: MUTED,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 20,
  },
  logEntry: {
    flexDirection: 'row',
    paddingVertical: 3,
    gap: 8,
  },
  logTimestamp: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    minWidth: 60,
  },
  logMessage: {
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
});
