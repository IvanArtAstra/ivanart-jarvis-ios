/**
 * HomeScreen v3 — с Always-On режимом и wake word индикатором
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Animated,
  Switch,
} from 'react-native';
import { useJarvis, AppState, ListenMode } from '../hooks/useJarvis';

const STATE_LABELS: Record<AppState, string> = {
  idle:        'Нажми и говори',
  wake_listen: 'Слушаю... скажи "Джарвис"',
  listening:   'Слушаю запрос...',
  thinking:    'Думаю...',
  speaking:    'Говорю...',
  error:       'Ошибка — попробуй снова',
};

const STATE_ICONS: Record<AppState, string> = {
  idle:        '🎙️',
  wake_listen: '👂',
  listening:   '🔴',
  thinking:    '🧠',
  speaking:    '🔊',
  error:       '⚠️',
};

const STATE_COLORS: Record<AppState, string> = {
  idle:        '#3B82F6',
  wake_listen: '#6B7280',
  listening:   '#DC2626',
  thinking:    '#7C3AED',
  speaking:    '#059669',
  error:       '#374151',
};

export const HomeScreen = () => {
  const {
    appState,
    listenMode,
    lastQuery,
    lastResponse,
    partialText,
    isGlassesConnected,
    error,
    sessionCount,
    startVoiceInteraction,
    stopListening,
    setListenMode,
    connectGlasses,
    disconnectGlasses,
  } = useJarvis();

  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  const waveAnim = React.useRef(new Animated.Value(0)).current;
  const isActive = !['idle', 'error'].includes(appState);

  React.useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.spring(pulseAnim, { toValue: 1, useNativeDriver: true }).start();
    }
  }, [isActive]);

  // Волна при wake_listen
  React.useEffect(() => {
    if (appState === 'wake_listen') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(waveAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
        ])
      ).start();
    } else {
      waveAnim.setValue(0);
    }
  }, [appState]);

  const handleVoiceButton = () => {
    if (appState === 'listening') {
      stopListening();
    } else if (appState === 'idle') {
      startVoiceInteraction();
    }
  };

  const handleModeToggle = (value: boolean) => {
    setListenMode(value ? 'always_on' : 'manual');
  };

  const btnDisabled = ['thinking', 'speaking', 'wake_listen'].includes(appState);

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>IvanArt × Jarvis</Text>
        <View style={styles.headerRow}>
          <Text style={styles.subtitle}>Два разума, одни очки ⚡</Text>
          {sessionCount > 0 && (
            <View style={styles.sessionBadge}>
              <Text style={styles.sessionBadgeText}>{sessionCount}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Always-On Toggle */}
      <View style={styles.modeCard}>
        <View style={styles.modeInfo}>
          <Text style={styles.modeTitle}>
            {listenMode === 'always_on' ? '🟢 Always-On режим' : '⚪ Ручной режим'}
          </Text>
          <Text style={styles.modeSubtitle}>
            {listenMode === 'always_on'
              ? 'Скажи "Джарвис" в любой момент'
              : 'Нажми кнопку чтобы говорить'}
          </Text>
        </View>
        <Switch
          value={listenMode === 'always_on'}
          onValueChange={handleModeToggle}
          trackColor={{ false: '#1F2937', true: '#1D4ED8' }}
          thumbColor={listenMode === 'always_on' ? '#3B82F6' : '#6B7280'}
          ios_backgroundColor="#1F2937"
        />
      </View>

      {/* Ray-Ban статус */}
      <TouchableOpacity
        style={styles.glassesCard}
        onPress={isGlassesConnected ? disconnectGlasses : connectGlasses}
        activeOpacity={0.8}
      >
        <View style={[styles.statusDot, isGlassesConnected ? styles.dotGreen : styles.dotRed]} />
        <View style={styles.glassesInfo}>
          <Text style={styles.glassesTitle}>
            {isGlassesConnected ? '🕶️ Ray-Ban подключены' : '🕶️ Ray-Ban не подключены'}
          </Text>
          <Text style={styles.glassesSubtitle}>
            {isGlassesConnected
              ? 'TTS через динамики очков'
              : 'Нажми чтобы подключить'}
          </Text>
        </View>
        <Text style={styles.glassesArrow}>{isGlassesConnected ? '✓' : '›'}</Text>
      </TouchableOpacity>

      {/* Частичное распознавание (реалтайм) */}
      {(appState === 'listening' || appState === 'wake_listen') && partialText ? (
        <View style={styles.partialCard}>
          <Text style={styles.partialText}>{partialText}</Text>
        </View>
      ) : null}

      {/* Последний запрос */}
      {lastQuery && appState !== 'listening' ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>ТЫ СКАЗАЛ</Text>
          <Text style={styles.queryText}>"{lastQuery}"</Text>
        </View>
      ) : null}

      {/* Ответ Jarvis */}
      <View style={[styles.card, styles.responseCard]}>
        <Text style={styles.cardLabel}>JARVIS</Text>
        <Text style={styles.responseText}>{error ?? lastResponse}</Text>
      </View>

      {/* Wake word волновой индикатор */}
      {appState === 'wake_listen' && (
        <View style={styles.waveContainer}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Animated.View
              key={i}
              style={[
                styles.waveBar,
                {
                  opacity: waveAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.2 + i * 0.1, 0.8 - i * 0.05],
                  }),
                  transform: [{
                    scaleY: waveAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.4 + i * 0.2, 1.0 + i * 0.3],
                    }),
                  }],
                },
              ]}
            />
          ))}
        </View>
      )}

      {/* Кнопка голоса (только в ручном режиме или для прерывания) */}
      {listenMode === 'manual' && (
        <View style={styles.voiceSection}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[styles.voiceButton, { backgroundColor: STATE_COLORS[appState] }]}
              onPress={handleVoiceButton}
              disabled={btnDisabled}
              activeOpacity={0.85}
            >
              {appState === 'thinking' ? (
                <ActivityIndicator color="#fff" size="large" />
              ) : (
                <Text style={styles.voiceIcon}>{STATE_ICONS[appState]}</Text>
              )}
            </TouchableOpacity>
          </Animated.View>

          <Text style={styles.stateLabel}>{STATE_LABELS[appState]}</Text>

          {appState === 'listening' && (
            <TouchableOpacity onPress={stopListening} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Отмена</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Always-On статус */}
      {listenMode === 'always_on' && (
        <View style={styles.alwaysOnStatus}>
          <Text style={styles.alwaysOnIcon}>{STATE_ICONS[appState]}</Text>
          <Text style={styles.alwaysOnLabel}>{STATE_LABELS[appState]}</Text>
        </View>
      )}

    </SafeAreaView>
  );
};

const BLUE = '#3B82F6';
const DARK_BG = '#0A0A0F';
const CARD_BG = '#13131F';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
    paddingHorizontal: 20,
  },
  header: {
    paddingTop: 28,
    paddingBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  subtitle: { fontSize: 13, color: '#4B5563' },
  sessionBadge: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sessionBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Mode toggle
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  modeInfo: { flex: 1 },
  modeTitle: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  modeSubtitle: { color: '#6B7280', fontSize: 12, marginTop: 2 },

  // Glasses card
  glassesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  statusDot: { width: 9, height: 9, borderRadius: 5, marginRight: 12 },
  dotGreen: { backgroundColor: '#10B981' },
  dotRed: { backgroundColor: '#374151' },
  glassesInfo: { flex: 1 },
  glassesTitle: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  glassesSubtitle: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  glassesArrow: { color: '#374151', fontSize: 20 },

  // Partial text
  partialCard: {
    backgroundColor: '#0F1117',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
    borderStyle: 'dashed',
  },
  partialText: { color: '#6B7280', fontSize: 14, fontStyle: 'italic' },

  // Cards
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  responseCard: {
    flex: 1,
    borderLeftWidth: 2,
    borderLeftColor: BLUE,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: '#374151',
    marginBottom: 8,
  },
  queryText: { color: '#9CA3AF', fontSize: 15, fontStyle: 'italic', lineHeight: 22 },
  responseText: { color: '#F9FAFB', fontSize: 17, lineHeight: 28 },

  // Wave bars (wake listen)
  waveContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: 40,
    gap: 5,
    marginBottom: 8,
  },
  waveBar: {
    width: 4,
    height: 24,
    backgroundColor: '#3B82F6',
    borderRadius: 2,
  },

  // Voice button
  voiceSection: {
    alignItems: 'center',
    paddingBottom: 40,
    paddingTop: 16,
    gap: 12,
  },
  voiceButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  voiceIcon: { fontSize: 36 },
  stateLabel: { color: '#6B7280', fontSize: 13 },
  cancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  cancelBtnText: { color: '#9CA3AF', fontSize: 14 },

  // Always-On status
  alwaysOnStatus: {
    alignItems: 'center',
    paddingBottom: 40,
    paddingTop: 16,
    gap: 8,
  },
  alwaysOnIcon: { fontSize: 32 },
  alwaysOnLabel: { color: '#6B7280', fontSize: 14 },
});
