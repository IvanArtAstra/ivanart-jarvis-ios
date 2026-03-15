/**
 * HomeScreen v2 — использует useJarvis хук
 * Полный цикл: Voice → Claude → TTS → Ray-Ban
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
  useEffect,
  useRef,
} from 'react-native';
import { useJarvis, AppState } from '../hooks/useJarvis';

const STATE_LABELS: Record<AppState, string> = {
  idle: 'Нажми и говори',
  listening: 'Слушаю...',
  thinking: 'Думаю...',
  speaking: 'Отвечаю...',
  error: 'Ошибка — попробуй снова',
};

const STATE_ICONS: Record<AppState, string> = {
  idle: '🎙️',
  listening: '🔴',
  thinking: '🧠',
  speaking: '🔊',
  error: '⚠️',
};

export const HomeScreen = () => {
  const {
    appState,
    lastQuery,
    lastResponse,
    isGlassesConnected,
    error,
    startVoiceInteraction,
    stopListening,
    connectGlasses,
    disconnectGlasses,
  } = useJarvis();

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isActive = appState !== 'idle' && appState !== 'error';

  // Пульсация при активности
  React.useEffect(() => {
    if (isActive) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      Animated.spring(pulseAnim, { toValue: 1, useNativeDriver: true }).start();
    }
  }, [isActive]);

  const handleVoiceButton = () => {
    if (appState === 'listening') {
      stopListening();
    } else if (appState === 'idle') {
      startVoiceInteraction();
    }
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>IvanArt × Jarvis</Text>
        <Text style={styles.subtitle}>Два разума, одни очки ⚡</Text>
      </View>

      {/* Статус Ray-Ban */}
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
            {isGlassesConnected ? 'Ответы идут через очки' : 'Нажми чтобы подключить'}
          </Text>
        </View>
        <Text style={styles.glassesArrow}>{isGlassesConnected ? '✓' : '›'}</Text>
      </TouchableOpacity>

      {/* Последний запрос */}
      {lastQuery ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>ТЫ</Text>
          <Text style={styles.queryText}>"{lastQuery}"</Text>
        </View>
      ) : null}

      {/* Ответ Jarvis */}
      <View style={[styles.card, styles.responseCard]}>
        <Text style={styles.cardLabel}>JARVIS</Text>
        <Text style={styles.responseText}>{error ?? lastResponse}</Text>
      </View>

      {/* Кнопка голоса */}
      <View style={styles.voiceSection}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[
              styles.voiceButton,
              appState === 'listening' && styles.voiceBtnListening,
              appState === 'thinking' && styles.voiceBtnThinking,
              appState === 'speaking' && styles.voiceBtnSpeaking,
              appState === 'error' && styles.voiceBtnError,
            ]}
            onPress={handleVoiceButton}
            disabled={appState === 'thinking' || appState === 'speaking'}
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
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: '#4B5563',
    marginTop: 4,
  },

  // Ray-Ban card
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
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 12,
  },
  dotGreen: { backgroundColor: '#10B981' },
  dotRed: { backgroundColor: '#374151' },
  glassesInfo: { flex: 1 },
  glassesTitle: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  glassesSubtitle: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  glassesArrow: { color: '#374151', fontSize: 20 },

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
    color: '#4B5563',
    marginBottom: 8,
  },
  queryText: {
    color: '#9CA3AF',
    fontSize: 16,
    fontStyle: 'italic',
    lineHeight: 24,
  },
  responseText: {
    color: '#F9FAFB',
    fontSize: 17,
    lineHeight: 28,
  },

  // Voice button
  voiceSection: {
    alignItems: 'center',
    paddingBottom: 48,
    paddingTop: 24,
    gap: 12,
  },
  voiceButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: BLUE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  voiceBtnListening: { backgroundColor: '#DC2626' },
  voiceBtnThinking: { backgroundColor: '#7C3AED' },
  voiceBtnSpeaking: { backgroundColor: '#059669' },
  voiceBtnError: { backgroundColor: '#374151' },
  voiceIcon: { fontSize: 38 },
  stateLabel: {
    color: '#6B7280',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  cancelBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  cancelBtnText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
});
