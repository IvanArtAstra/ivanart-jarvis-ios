/**
 * HomeScreen v5 — Jarvis HUD + Glasses Provider Integration
 * 
 * Changes from v4:
 *   - Uses useJarvis v3 (connectionManager instead of bleService)
 *   - Shows active provider (BLE/SDK) badge
 *   - Camera/translate/remember quick actions (SDK mode)
 *   - 'capturing' state with camera animation
 *   - Provider-aware glasses card
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Animated,
  Switch,
  Modal,
  ScrollView,
} from 'react-native';
import { SettingsScreen } from './SettingsScreen';
import { useJarvis, AppState, ListenMode } from '../hooks/useJarvis';

const STATE_LABELS: Record<AppState, string> = {
  idle:        'Нажми и говори',
  wake_listen: 'Слушаю... скажи "Джарвис"',
  listening:   'Слушаю запрос...',
  thinking:    'Обрабатываю...',
  speaking:    'Отвечаю...',
  capturing:   'Снимаю...',
  error:       'Ошибка — попробуй снова',
};

const STATE_ICONS: Record<AppState, string> = {
  idle:        '🎙',
  wake_listen: '👂',
  listening:   '●',
  thinking:    '◈',
  speaking:    '◉',
  capturing:   '📷',
  error:       '⚠',
};

const STATE_COLORS: Record<AppState, string> = {
  idle:        '#00C2FF',
  wake_listen: '#6B7280',
  listening:   '#FF3B3B',
  thinking:    '#A855F7',
  speaking:    '#00D4A0',
  capturing:   '#FBBF24',
  error:       '#374151',
};

const STATE_GLOW: Record<AppState, string> = {
  idle:        'rgba(0,194,255,0.35)',
  wake_listen: 'rgba(107,114,128,0.25)',
  listening:   'rgba(255,59,59,0.40)',
  thinking:    'rgba(168,85,247,0.40)',
  speaking:    'rgba(0,212,160,0.40)',
  capturing:   'rgba(251,191,36,0.40)',
  error:       'rgba(55,65,81,0.20)',
};

const PROVIDER_LABELS = {
  sdk: { label: 'SDK', color: '#A855F7', icon: '📱' },
  ble: { label: 'BLE', color: '#3B82F6', icon: '📡' },
  none: { label: 'OFF', color: '#374151', icon: '🕶️' },
};

export const HomeScreen = () => {
  const {
    appState,
    listenMode,
    lastQuery,
    lastResponse,
    partialText,
    isGlassesConnected,
    glassesProvider,
    error,
    sessionCount,
    startVoiceInteraction,
    stopListening,
    setListenMode,
    connectGlasses,
    disconnectGlasses,
    captureAndAnalyze,
    captureAndTranslate,
    captureAndRemember,
  } = useJarvis();

  const [showSettings, setShowSettings] = useState(false);
  const pulseAnim   = React.useRef(new Animated.Value(1)).current;
  const ringAnim    = React.useRef(new Animated.Value(0)).current;
  const waveAnim    = React.useRef(new Animated.Value(0)).current;
  const glowAnim    = React.useRef(new Animated.Value(0.5)).current;
  const isActive    = !['idle', 'error'].includes(appState);

  const providerInfo = PROVIDER_LABELS[glassesProvider];
  const hasSDK = glassesProvider === 'sdk';

  // Пульс кнопки
  React.useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.00, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.spring(pulseAnim, { toValue: 1, useNativeDriver: true }).start();
    }
  }, [isActive]);

  // Внешнее кольцо
  React.useEffect(() => {
    Animated.loop(
      Animated.timing(ringAnim, { toValue: 1, duration: 2400, useNativeDriver: true })
    ).start();
  }, []);

  // Волна wake
  React.useEffect(() => {
    if (appState === 'wake_listen') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(waveAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else { waveAnim.setValue(0); }
  }, [appState]);

  // Glow пульс фона
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 3000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.4, duration: 3000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleVoiceButton = () => {
    if (appState === 'listening')      { stopListening(); }
    else if (appState === 'idle')      { startVoiceInteraction(); }
  };

  const btnDisabled = ['thinking', 'speaking', 'wake_listen', 'capturing'].includes(appState);
  const activeColor = STATE_COLORS[appState];
  const activeGlow  = STATE_GLOW[appState];

  return (
    <SafeAreaView style={styles.container}>

      {/* Ambient glow background */}
      <Animated.View style={[styles.ambientGlow, { opacity: glowAnim, shadowColor: activeColor }]} />

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" presentationStyle="fullScreen">
        <SettingsScreen onClose={() => setShowSettings(false)} />
      </Modal>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>
                IvanArt <Text style={styles.titleAccent}>×</Text> Jarvis
              </Text>
              <Text style={styles.subtitle}>Два разума, одни очки</Text>
            </View>
            <View style={styles.headerRight}>
              {sessionCount > 0 && (
                <View style={styles.sessionBadge}>
                  <Text style={styles.sessionBadgeText}>{sessionCount}</Text>
                </View>
              )}
              <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.settingsBtn}>
                <Text style={styles.settingsIcon}>⚙️</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Status bar */}
          <View style={styles.statusBar}>
            <View style={[styles.statusDot, { backgroundColor: activeColor }]} />
            <Text style={[styles.statusText, { color: activeColor }]}>
              {STATE_LABELS[appState].toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ── CARDS ROW ── */}
        <View style={styles.cardsRow}>
          {/* Mode Toggle */}
          <View style={[styles.miniCard, { flex: 1, marginRight: 8 }]}>
            <Text style={styles.miniCardLabel}>РЕЖИМ</Text>
            <View style={styles.switchRow}>
              <Text style={styles.miniCardValue}>
                {listenMode === 'always_on' ? '🟢 Always-On' : '⚪ Ручной'}
              </Text>
              <Switch
                value={listenMode === 'always_on'}
                onValueChange={(v) => setListenMode(v ? 'always_on' : 'manual')}
                trackColor={{ false: '#1A2030', true: '#003A5C' }}
                thumbColor={listenMode === 'always_on' ? '#00C2FF' : '#4B5563'}
                ios_backgroundColor="#1A2030"
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </View>

          {/* Ray-Ban Status — now shows provider */}
          <TouchableOpacity
            style={[styles.miniCard, { flex: 1 }]}
            onPress={isGlassesConnected ? disconnectGlasses : connectGlasses}
            activeOpacity={0.8}
          >
            <Text style={styles.miniCardLabel}>RAY-BAN</Text>
            <View style={styles.switchRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.miniCardValue}>
                  {isGlassesConnected ? providerInfo.icon : '🕶️'} {isGlassesConnected ? 'ON' : 'OFF'}
                </Text>
                {isGlassesConnected && (
                  <View style={[styles.providerBadge, { backgroundColor: providerInfo.color + '22', borderColor: providerInfo.color + '44' }]}>
                    <Text style={[styles.providerBadgeText, { color: providerInfo.color }]}>
                      {providerInfo.label}
                    </Text>
                  </View>
                )}
              </View>
              <View style={[styles.connDot, { backgroundColor: isGlassesConnected ? '#00D4A0' : '#374151' }]} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── QUICK ACTIONS (SDK only) ── */}
        {isGlassesConnected && hasSDK && (
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={captureAndAnalyze}
              disabled={btnDisabled}
            >
              <Text style={styles.quickBtnIcon}>📷</Text>
              <Text style={styles.quickBtnLabel}>Что вижу?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickBtn}
              onPress={captureAndTranslate}
              disabled={btnDisabled}
            >
              <Text style={styles.quickBtnIcon}>🌐</Text>
              <Text style={styles.quickBtnLabel}>Переведи</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickBtn}
              onPress={captureAndRemember}
              disabled={btnDisabled}
            >
              <Text style={styles.quickBtnIcon}>💾</Text>
              <Text style={styles.quickBtnLabel}>Запомни</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── RESPONSE CARD ── */}
        <View style={[styles.responseCard, { borderLeftColor: activeColor }]}>
          <View style={styles.responseHeader}>
            <Text style={[styles.responseLabel, { color: activeColor }]}>◈ JARVIS</Text>
            {(appState === 'thinking' || appState === 'capturing') && (
              <View style={styles.thinkingDots}>
                {[0, 1, 2].map(i => (
                  <Animated.View key={i} style={[styles.dot, {
                    opacity: waveAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3 + i * 0.2, 1] })
                  }]} />
                ))}
              </View>
            )}
          </View>

          {partialText && (appState === 'listening' || appState === 'wake_listen') ? (
            <Text style={styles.partialText}>{partialText}</Text>
          ) : (
            <Text style={styles.responseText}>
              {error ?? lastResponse ?? 'Jarvis готов. Скажи "Джарвис" или нажми кнопку.'}
            </Text>
          )}

          {lastQuery && appState === 'idle' && (
            <View style={styles.queryRow}>
              <Text style={styles.queryLabel}>ТЫ: </Text>
              <Text style={styles.queryText}>"{lastQuery}"</Text>
            </View>
          )}
        </View>

        {/* ── WAVE BARS (wake_listen) ── */}
        {appState === 'wake_listen' && (
          <View style={styles.waveContainer}>
            {[0.5, 0.8, 1.2, 0.8, 0.5, 1.0, 0.6].map((h, i) => (
              <Animated.View
                key={i}
                style={[styles.waveBar, {
                  backgroundColor: activeColor,
                  transform: [{
                    scaleY: waveAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [h * 0.4, h * 1.4],
                    }),
                  }],
                  opacity: waveAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.4, 0.95],
                  }),
                }]}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── VOICE BUTTON AREA (sticky bottom) ── */}
      <View style={styles.voiceArea}>
        {listenMode === 'manual' && (
          <>
            {/* Outer ring */}
            <Animated.View style={[styles.outerRing, {
              borderColor: activeColor,
              opacity: ringAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.15, 0.4, 0.15] }),
              transform: [{ scale: ringAnim.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.25] }) }],
            }]} />

            {/* Middle ring */}
            <Animated.View style={[styles.middleRing, {
              borderColor: activeColor,
              opacity: isActive ? 0.5 : 0.25,
              transform: [{ scale: pulseAnim.interpolate({ inputRange: [1, 1.08], outputRange: [1.12, 1.20] }) }],
            }]} />

            {/* Main button */}
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={[styles.voiceButton, {
                  backgroundColor: btnDisabled ? '#0A0E1A' : activeColor,
                  shadowColor: activeGlow,
                }]}
                onPress={handleVoiceButton}
                disabled={btnDisabled}
                activeOpacity={0.85}
              >
                {(appState === 'thinking' || appState === 'capturing') ? (
                  <ActivityIndicator color={activeColor} size="large" />
                ) : (
                  <Text style={[styles.voiceIcon, { color: btnDisabled ? activeColor : '#000' }]}>
                    {STATE_ICONS[appState]}
                  </Text>
                )}
              </TouchableOpacity>
            </Animated.View>

            {appState === 'listening' && (
              <TouchableOpacity onPress={stopListening} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>СТОП</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {listenMode === 'always_on' && (
          <View style={styles.alwaysOnRow}>
            <Animated.View style={[styles.alwaysOnDot, {
              backgroundColor: activeColor,
              transform: [{ scale: pulseAnim }],
              shadowColor: activeGlow,
            }]} />
            <Text style={[styles.alwaysOnLabel, { color: activeColor }]}>
              {STATE_LABELS[appState]}
            </Text>
          </View>
        )}
      </View>

    </SafeAreaView>
  );
};

// ── DESIGN TOKENS ──
const BG       = '#040810';
const CARD_BG  = 'rgba(10,14,26,0.95)';
const BORDER   = 'rgba(0,194,255,0.12)';
const CYAN     = '#00C2FF';
const TEXT     = '#E8EDF5';
const MUTED    = '#3A4456';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { paddingHorizontal: 20, paddingBottom: 160 },
  ambientGlow: {
    position: 'absolute', top: -60, alignSelf: 'center',
    width: 340, height: 340, borderRadius: 170,
    backgroundColor: 'transparent',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.18, shadowRadius: 90,
  },

  // ── HEADER ──
  header: { paddingTop: 24, paddingBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 28, fontWeight: '700', color: TEXT, letterSpacing: -0.5 },
  titleAccent: { color: CYAN, fontWeight: '300' },
  subtitle: { fontSize: 13, color: MUTED, marginTop: 2, letterSpacing: 0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessionBadge: {
    backgroundColor: 'rgba(0,194,255,0.15)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(0,194,255,0.3)',
  },
  sessionBadgeText: { color: CYAN, fontSize: 12, fontWeight: '700' },
  settingsBtn: { padding: 4 },
  settingsIcon: { fontSize: 20 },

  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16,
    backgroundColor: CARD_BG, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: BORDER,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },

  // ── MINI CARDS ──
  cardsRow: { flexDirection: 'row', marginBottom: 12, marginTop: 4 },
  miniCard: {
    backgroundColor: CARD_BG, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  miniCardLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: MUTED, marginBottom: 8 },
  miniCardValue: { color: TEXT, fontSize: 13, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  connDot: { width: 10, height: 10, borderRadius: 5 },

  // ── Provider Badge ──
  providerBadge: {
    paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 6, borderWidth: 1,
  },
  providerBadgeText: { fontSize: 9, fontWeight: '700' },

  // ── QUICK ACTIONS ──
  quickActions: {
    flexDirection: 'row', gap: 8, marginBottom: 12,
  },
  quickBtn: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 14, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER,
  },
  quickBtnIcon: { fontSize: 22, marginBottom: 4 },
  quickBtnLabel: { color: MUTED, fontSize: 10, fontWeight: '600' },

  // ── RESPONSE CARD ──
  responseCard: {
    backgroundColor: CARD_BG, borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: BORDER, borderLeftWidth: 2,
    minHeight: 160, marginBottom: 12,
  },
  responseHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14,
  },
  responseLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 2.5 },
  thinkingDots: { flexDirection: 'row', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: CYAN },
  responseText: { color: TEXT, fontSize: 17, lineHeight: 27, fontWeight: '400' },
  partialText: { color: MUTED, fontSize: 15, lineHeight: 24, fontStyle: 'italic' },
  queryRow: {
    flexDirection: 'row', marginTop: 16, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
  },
  queryLabel: { color: MUTED, fontSize: 12, fontWeight: '600' },
  queryText: { color: MUTED, fontSize: 13, fontStyle: 'italic', flex: 1 },

  // ── WAVE BARS ──
  waveContainer: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    height: 44, gap: 4, marginBottom: 8,
  },
  waveBar: { width: 3, height: 28, borderRadius: 2 },

  // ── VOICE AREA ──
  voiceArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingBottom: 44, paddingTop: 20,
    backgroundColor: 'rgba(4,8,16,0.85)',
    borderTopWidth: 1, borderTopColor: BORDER, gap: 12,
  },
  outerRing: {
    position: 'absolute', width: 148, height: 148, borderRadius: 74,
    borderWidth: 1, top: '50%', marginTop: -74,
  },
  middleRing: {
    position: 'absolute', width: 116, height: 116, borderRadius: 58,
    borderWidth: 1, top: '50%', marginTop: -58,
  },
  voiceButton: {
    width: 92, height: 92, borderRadius: 46,
    justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 24, elevation: 14,
  },
  voiceIcon: { fontSize: 32, fontWeight: '300' },

  cancelBtn: {
    paddingHorizontal: 24, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,59,59,0.35)',
  },
  cancelBtnText: { color: '#FF3B3B', fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },

  // ── ALWAYS-ON ──
  alwaysOnRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  alwaysOnDot: {
    width: 14, height: 14, borderRadius: 7,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },
  alwaysOnLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
});
