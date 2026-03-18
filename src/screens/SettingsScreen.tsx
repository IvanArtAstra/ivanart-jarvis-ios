/**
 * SettingsScreen.tsx v3 — Настройки Jarvis
 * 
 * Секции:
 *   1. 🕶️ Подключение очков — BLE / SDK / Auto переключатель
 *   2. 🔗 Bridge URL — сервер Jarvis
 *   3. 🎙️ Voice ID — ElevenLabs
 *   4. 📱 Голосовые команды
 *   5. ℹ️ О приложении
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, ActivityIndicator,
  Platform,
} from 'react-native';
import {
  getBridgeUrl, setBridgeUrl,
  getVoiceId, setVoiceId,
  BRIDGE_URL_DEFAULT,
} from '../utils/config';
import { agentBridgeService } from '../services/agentBridgeService';
import { useGlasses } from '../hooks/useGlasses';
import type { ConnectionMode } from '../services/glasses';

interface Props {
  onClose: () => void;
}

const BRIDGE_PRESETS = [
  { label: '🏠 Tailscale', value: 'ws://100.70.68.84:8766' },
  { label: '🔧 Localhost', value: 'ws://localhost:8766' },
];

const CONNECTION_MODES: { mode: ConnectionMode; label: string; icon: string; desc: string }[] = [
  { mode: 'auto',  label: 'Авто',     icon: '🔄', desc: 'SDK → BLE fallback' },
  { mode: 'sdk',   label: 'Meta SDK', icon: '📱', desc: 'Полные возможности' },
  { mode: 'ble',   label: 'BLE UART', icon: '📡', desc: 'Только текст' },
];

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  disconnected: { label: 'Отключён',    color: '#6B7280' },
  scanning:     { label: 'Сканирую…',   color: '#FBBF24' },
  connecting:   { label: 'Соединяю…',   color: '#FBBF24' },
  connected:    { label: 'Подключён',    color: '#10B981' },
  error:        { label: 'Ошибка',       color: '#EF4444' },
};

export const SettingsScreen: React.FC<Props> = ({ onClose }) => {
  const glasses = useGlasses();
  
  const [bridgeUrl, setBridgeUrlState] = useState('');
  const [voiceId, setVoiceIdState] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setBridgeUrlState(await getBridgeUrl());
      setVoiceIdState(await getVoiceId());
    })();
  }, []);

  const handleSave = async () => {
    await setBridgeUrl(bridgeUrl);
    await setVoiceId(voiceId);
    agentBridgeService.disconnect();
    agentBridgeService.connect();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const httpUrl = bridgeUrl
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace(/\/$/, '') + '/health';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(httpUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setTestResult(`✅ Bridge OK! Clients: ${data.clients ?? 0}, Queries: ${data.queries ?? 0}`);
      } else {
        setTestResult(`⚠️ HTTP ${res.status}`);
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setTestResult('❌ Timeout — сервер недоступен');
      } else {
        setTestResult(`❌ ${e.message}`);
      }
    }
    setTesting(false);
  };

  const handleModeChange = async (mode: ConnectionMode) => {
    await glasses.setMode(mode);
  };

  const handleGlassesConnect = async () => {
    await glasses.connect();
  };

  const { status } = glasses;
  const bleStatus = STATE_LABELS[status.bleState] ?? STATE_LABELS.disconnected;
  const sdkStatus = STATE_LABELS[status.sdkState] ?? STATE_LABELS.disconnected;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>⚙️ Настройки</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeTxt}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ═══════════════ GLASSES CONNECTION ═══════════════ */}
        <Text style={styles.sectionTitle}>🕶️ Подключение очков</Text>
        <Text style={styles.hint}>
          Выберите режим подключения к Ray-Ban Meta Smart Glasses
        </Text>

        {/* Mode Selector */}
        <View style={styles.modeSelector}>
          {CONNECTION_MODES.map(({ mode, label, icon, desc }) => {
            const isActive = glasses.mode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.modeCard, isActive && styles.modeCardActive]}
                onPress={() => handleModeChange(mode)}
                activeOpacity={0.7}
              >
                <Text style={styles.modeIcon}>{icon}</Text>
                <Text style={[styles.modeLabel, isActive && styles.modeLabelActive]}>
                  {label}
                </Text>
                <Text style={styles.modeDesc}>{desc}</Text>
                {isActive && <View style={styles.modeActiveDot} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Provider Status Cards */}
        <View style={styles.providerRow}>
          {/* BLE Status */}
          <View style={[styles.providerCard,
            status.activeProvider === 'ble' && styles.providerCardActive]}>
            <View style={styles.providerHeader}>
              <Text style={styles.providerIcon}>📡</Text>
              <Text style={styles.providerLabel}>BLE UART</Text>
            </View>
            <View style={styles.providerStatusRow}>
              <View style={[styles.providerDot, { backgroundColor: bleStatus.color }]} />
              <Text style={[styles.providerStatusText, { color: bleStatus.color }]}>
                {bleStatus.label}
              </Text>
            </View>
            {status.bleInfo && (
              <View style={styles.providerDetails}>
                <Text style={styles.detailText}>📱 {status.bleInfo.name}</Text>
                {status.bleInfo.signalStrength !== 0 && (
                  <Text style={styles.detailText}>📶 {status.bleInfo.signalStrength} dBm</Text>
                )}
              </View>
            )}
            {/* BLE Capabilities */}
            <View style={styles.capList}>
              <CapabilityBadge label="Текст" available={true} />
              <CapabilityBadge label="Камера" available={false} />
              <CapabilityBadge label="Дисплей" available={false} />
            </View>
          </View>

          {/* SDK Status */}
          <View style={[styles.providerCard,
            status.activeProvider === 'sdk' && styles.providerCardActive]}>
            <View style={styles.providerHeader}>
              <Text style={styles.providerIcon}>📱</Text>
              <Text style={styles.providerLabel}>Meta SDK</Text>
            </View>
            <View style={styles.providerStatusRow}>
              <View style={[styles.providerDot, { backgroundColor: sdkStatus.color }]} />
              <Text style={[styles.providerStatusText, { color: sdkStatus.color }]}>
                {sdkStatus.label}
              </Text>
            </View>
            {status.sdkInfo && (
              <View style={styles.providerDetails}>
                <Text style={styles.detailText}>📱 {status.sdkInfo.name}</Text>
                {status.sdkInfo.batteryLevel > 0 && (
                  <Text style={styles.detailText}>🔋 {status.sdkInfo.batteryLevel}%</Text>
                )}
              </View>
            )}
            {/* SDK Capabilities */}
            <View style={styles.capList}>
              <CapabilityBadge label="Текст" available={true} />
              <CapabilityBadge label="Камера" available={true} />
              <CapabilityBadge label="Дисплей" available={true} />
              <CapabilityBadge label="Жесты" available={true} />
              <CapabilityBadge label="Голос" available={true} />
              <CapabilityBadge label="LED" available={true} />
            </View>
          </View>
        </View>

        {/* Connect / Disconnect button */}
        <TouchableOpacity
          style={[styles.connectBtn,
            glasses.isConnected ? styles.connectBtnDisconnect : styles.connectBtnConnect]}
          onPress={glasses.isConnected ? glasses.disconnect : handleGlassesConnect}
          disabled={glasses.isScanning}
        >
          {glasses.isScanning ? (
            <ActivityIndicator color="#00C2FF" size="small" />
          ) : (
            <Text style={[styles.connectBtnText,
              glasses.isConnected ? styles.connectBtnTextDisconnect : styles.connectBtnTextConnect]}>
              {glasses.isConnected ? '🔌 Отключить очки' : '🔍 Сканировать и подключить'}
            </Text>
          )}
        </TouchableOpacity>

        {glasses.lastError && (
          <Text style={styles.errorText}>⚠️ {glasses.lastError}</Text>
        )}

        {/* Active provider info */}
        {glasses.isConnected && (
          <View style={styles.activeInfo}>
            <Text style={styles.activeInfoText}>
              🟢 Активный провайдер: <Text style={styles.activeInfoHighlight}>
                {status.activeProvider === 'sdk' ? 'Meta SDK' : 'BLE UART'}
              </Text>
            </Text>
            {glasses.hasCamera && (
              <Text style={styles.activeInfoFeature}>📷 Камера доступна</Text>
            )}
            {glasses.hasDisplay && (
              <Text style={styles.activeInfoFeature}>📺 Дисплей доступен</Text>
            )}
            {glasses.hasAudioStream && (
              <Text style={styles.activeInfoFeature}>🎤 Аудио стрим доступен</Text>
            )}
            {glasses.hasGestures && (
              <Text style={styles.activeInfoFeature}>👆 Жесты доступны</Text>
            )}
          </View>
        )}

        {/* ═══════════════ BRIDGE URL ═══════════════ */}
        <Text style={[styles.sectionTitle, { marginTop: 32 }]}>🔗 Bridge URL</Text>
        <Text style={styles.hint}>
          WebSocket адрес jarvis_ios_bridge.py (порт 8766).
        </Text>

        <View style={styles.presets}>
          {BRIDGE_PRESETS.map(p => (
            <TouchableOpacity
              key={p.value}
              style={[styles.preset, bridgeUrl === p.value && styles.presetActive]}
              onPress={() => setBridgeUrlState(p.value)}
            >
              <Text style={[styles.presetTxt, bridgeUrl === p.value && styles.presetTxtActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.input}
          value={bridgeUrl}
          onChangeText={setBridgeUrlState}
          placeholder="ws://100.70.68.84:8766"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <TouchableOpacity style={styles.testBtn} onPress={handleTest} disabled={testing}>
          {testing
            ? <ActivityIndicator color="#00C2FF" size="small" />
            : <Text style={styles.testTxt}>🔌 Проверить подключение</Text>
          }
        </TouchableOpacity>
        {testResult && (
          <Text style={[styles.testResult,
            testResult.startsWith('✅') ? styles.ok : styles.err]}>
            {testResult}
          </Text>
        )}

        {/* ═══════════════ VOICE ID ═══════════════ */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>🎙️ ElevenLabs Voice ID</Text>
        <Text style={styles.hint}>
          ID голоса Jarvis. Найди в ElevenLabs → My Voices.
        </Text>
        <TextInput
          style={styles.input}
          value={voiceId}
          onChangeText={setVoiceIdState}
          placeholder="pNInz6obpgDQGcFmaJgB"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* ═══════════════ VOICE COMMANDS ═══════════════ */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>📱 Голосовые команды</Text>
        <Text style={styles.hint}>
          {glasses.mode === 'ble'
            ? 'Голосовые команды доступны только через Meta SDK'
            : 'Что умеет Jarvis:'}
        </Text>
        {[
          { cmd: '"Джарвис"',                  desc: 'Активация',    sdk: true },
          { cmd: '"Джарвис, что я вижу?"',     desc: 'Камера + AI',  sdk: true },
          { cmd: '"Джарвис, переведи"',        desc: 'Перевод',      sdk: true },
          { cmd: '"Джарвис, запомни"',         desc: 'Память',       sdk: true },
          { cmd: '"Джарвис, статус системы"',  desc: 'Статус',       sdk: false },
          { cmd: '"Стоп Джарвис"',             desc: 'Остановить',   sdk: false },
        ].map((item, i) => (
          <View key={i} style={styles.cmdRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cmdTxt}>{item.cmd}</Text>
              <Text style={styles.cmdDesc}>{item.desc}</Text>
            </View>
            {item.sdk && (
              <View style={styles.sdkBadge}>
                <Text style={styles.sdkBadgeText}>SDK</Text>
              </View>
            )}
          </View>
        ))}

        {/* ═══════════════ ABOUT ═══════════════ */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>ℹ️ О приложении</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Версия</Text>
          <Text style={styles.aboutValue}>0.2.0</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Bridge</Text>
          <Text style={[styles.aboutValue,
            agentBridgeService.connected ? { color: '#10B981' } : { color: '#EF4444' }]}>
            {agentBridgeService.connected ? '● Connected' : '● Offline'}
          </Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Очки</Text>
          <Text style={[styles.aboutValue, { color: glasses.isConnected ? '#10B981' : '#EF4444' }]}>
            {glasses.isConnected
              ? `● ${status.activeProvider.toUpperCase()}`
              : '● Offline'}
          </Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Model</Text>
          <Text style={styles.aboutValue}>Claude via OpenClaw</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Save */}
      <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
        <Text style={styles.saveTxt}>
          {saved ? '✅ Сохранено!' : '💾 Сохранить'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// ─── Capability Badge Component ────────────────────────────────

const CapabilityBadge = ({ label, available }: { label: string; available: boolean }) => (
  <View style={[capStyles.badge, available ? capStyles.badgeOn : capStyles.badgeOff]}>
    <Text style={[capStyles.text, available ? capStyles.textOn : capStyles.textOff]}>
      {available ? '✓' : '✗'} {label}
    </Text>
  </View>
);

const capStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, marginRight: 4, marginBottom: 4,
  },
  badgeOn:  { backgroundColor: 'rgba(0,194,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,194,255,0.25)' },
  badgeOff: { backgroundColor: 'rgba(107,114,128,0.12)', borderWidth: 1, borderColor: 'rgba(107,114,128,0.2)' },
  text:     { fontSize: 10, fontWeight: '600' },
  textOn:   { color: '#00C2FF' },
  textOff:  { color: '#6B7280' },
});

// ─── Main Styles ────────────────────────────────────────────────

const CYAN = '#00C2FF';
const BG = '#040810';
const CARD_BG = 'rgba(10,14,26,0.95)';
const BORDER = 'rgba(0,194,255,0.12)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  closeBtn: { padding: 8 },
  closeTxt: { color: '#888', fontSize: 20 },
  scroll: { flex: 1, paddingHorizontal: 20 },

  sectionTitle: { color: CYAN, fontSize: 14, fontWeight: '600', marginTop: 24, marginBottom: 6 },
  hint: { color: '#6B7280', fontSize: 12, marginBottom: 12, lineHeight: 18 },

  // ── Mode Selector ──
  modeSelector: {
    flexDirection: 'row', gap: 8, marginBottom: 16,
  },
  modeCard: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  modeCardActive: {
    borderColor: CYAN,
    backgroundColor: 'rgba(0,194,255,0.06)',
  },
  modeIcon: { fontSize: 22, marginBottom: 6 },
  modeLabel: { color: '#9CA3AF', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  modeLabelActive: { color: CYAN },
  modeDesc: { color: '#4B5563', fontSize: 9, textAlign: 'center' },
  modeActiveDot: {
    position: 'absolute', top: 8, right: 8,
    width: 6, height: 6, borderRadius: 3, backgroundColor: CYAN,
  },

  // ── Provider Cards ──
  providerRow: {
    flexDirection: 'row', gap: 8, marginBottom: 12,
  },
  providerCard: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  providerCardActive: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16,185,129,0.04)',
  },
  providerHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8,
  },
  providerIcon: { fontSize: 14 },
  providerLabel: { color: '#D1D5DB', fontSize: 12, fontWeight: '700' },
  providerStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6,
  },
  providerDot: { width: 6, height: 6, borderRadius: 3 },
  providerStatusText: { fontSize: 11, fontWeight: '600' },
  providerDetails: { marginBottom: 6 },
  detailText: { color: '#6B7280', fontSize: 10, marginBottom: 2 },
  capList: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },

  // ── Connect Button ──
  connectBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, marginBottom: 8,
  },
  connectBtnConnect: {
    backgroundColor: 'rgba(0,194,255,0.08)', borderColor: CYAN,
  },
  connectBtnDisconnect: {
    backgroundColor: 'rgba(239,68,68,0.08)', borderColor: '#EF4444',
  },
  connectBtnText: { fontSize: 14, fontWeight: '700' },
  connectBtnTextConnect: { color: CYAN },
  connectBtnTextDisconnect: { color: '#EF4444' },

  errorText: {
    color: '#EF4444', fontSize: 12, textAlign: 'center', marginBottom: 8,
  },

  // ── Active Info ──
  activeInfo: {
    backgroundColor: 'rgba(16,185,129,0.06)',
    borderRadius: 12, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.2)',
  },
  activeInfoText: { color: '#D1D5DB', fontSize: 13, marginBottom: 6 },
  activeInfoHighlight: { color: '#10B981', fontWeight: '700' },
  activeInfoFeature: { color: '#6B7280', fontSize: 12, marginBottom: 2, paddingLeft: 8 },

  // ── Bridge & inputs ──
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  preset: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#1a1a2e', backgroundColor: CARD_BG,
  },
  presetActive: { borderColor: CYAN, backgroundColor: 'rgba(0,194,255,0.06)' },
  presetTxt: { color: '#888', fontSize: 12 },
  presetTxtActive: { color: CYAN },
  input: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    color: '#fff', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  testBtn: {
    marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: CYAN,
    paddingVertical: 10, alignItems: 'center',
  },
  testTxt: { color: CYAN, fontSize: 14 },
  testResult: { marginTop: 8, fontSize: 13, textAlign: 'center' },
  ok: { color: '#10B981' },
  err: { color: '#EF4444' },

  // ── Voice commands ──
  cmdRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  cmdTxt: { color: '#D1D5DB', fontSize: 13, fontStyle: 'italic' },
  cmdDesc: { color: '#4B5563', fontSize: 10, marginTop: 2 },
  sdkBadge: {
    backgroundColor: 'rgba(168,85,247,0.15)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)',
  },
  sdkBadgeText: { color: '#A855F7', fontSize: 9, fontWeight: '700' },

  // ── About ──
  aboutRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  aboutLabel: { color: '#6B7280', fontSize: 13 },
  aboutValue: { color: '#D1D5DB', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  // ── Save ──
  saveBtn: {
    margin: 20, borderRadius: 14, backgroundColor: 'rgba(0,194,255,0.08)',
    borderWidth: 1, borderColor: CYAN, paddingVertical: 14, alignItems: 'center',
  },
  saveTxt: { color: CYAN, fontSize: 16, fontWeight: '700' },
});
