/**
 * HomeScreen — главный экран приложения
 * IvanArt × Jarvis
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Animated,
} from 'react-native';
import { bleService } from '../services/bleService';
import { jarvisService } from '../services/jarvisService';

type ConnectionStatus = 'disconnected' | 'scanning' | 'connected';
type ListeningStatus = 'idle' | 'listening' | 'processing';

export const HomeScreen = () => {
  const [connection, setConnection] = useState<ConnectionStatus>('disconnected');
  const [listening, setListening] = useState<ListeningStatus>('idle');
  const [lastQuery, setLastQuery] = useState('');
  const [lastResponse, setLastResponse] = useState('Jarvis готов к работе...');
  const pulseAnim = new Animated.Value(1);

  // Пульсация при прослушивании
  useEffect(() => {
    if (listening === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [listening]);

  const handleConnect = async () => {
    setConnection('scanning');
    try {
      await bleService.scanForGlasses((device) => {
        bleService.connect(device.id).then(() => {
          setConnection('connected');
          setLastResponse('Ray-Ban подключены ✓');
        });
      });
    } catch {
      setConnection('disconnected');
      setLastResponse('Очки не найдены. Убедись что они включены.');
    }
  };

  const handleVoicePress = () => {
    if (listening !== 'idle') return;
    setListening('listening');
    // TODO: запустить Whisper/Voice recording
    // Пример: VoiceService.start() -> onResult -> handleQuery
  };

  const handleQuery = async (text: string) => {
    setLastQuery(text);
    setListening('processing');
    
    const response = await jarvisService.ask(text);
    setLastResponse(response);
    
    // Отправить ответ на очки (TTS через BLE)
    if (bleService.isConnected()) {
      await bleService.sendToGlasses(response);
    }
    
    setListening('idle');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Заголовок */}
      <View style={styles.header}>
        <Text style={styles.title}>IvanArt × Jarvis</Text>
        <Text style={styles.subtitle}>Два разума, одни очки ⚡</Text>
      </View>

      {/* Статус очков */}
      <View style={styles.statusCard}>
        <View style={[styles.statusDot, 
          connection === 'connected' ? styles.dotGreen : 
          connection === 'scanning' ? styles.dotYellow : styles.dotRed
        ]} />
        <Text style={styles.statusText}>
          {connection === 'connected' ? 'Ray-Ban подключены' :
           connection === 'scanning' ? 'Поиск очков...' : 'Очки не подключены'}
        </Text>
        {connection === 'disconnected' && (
          <TouchableOpacity style={styles.connectBtn} onPress={handleConnect}>
            <Text style={styles.connectBtnText}>Подключить</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Последний запрос */}
      {lastQuery ? (
        <View style={styles.queryCard}>
          <Text style={styles.queryLabel}>Ты сказал:</Text>
          <Text style={styles.queryText}>"{lastQuery}"</Text>
        </View>
      ) : null}

      {/* Ответ Jarvis */}
      <View style={styles.responseCard}>
        <Text style={styles.responseLabel}>Jarvis:</Text>
        <Text style={styles.responseText}>{lastResponse}</Text>
      </View>

      {/* Кнопка голоса */}
      <Animated.View style={[styles.voiceButtonWrapper, { transform: [{ scale: pulseAnim }] }]}>
        <TouchableOpacity
          style={[styles.voiceButton, listening !== 'idle' && styles.voiceButtonActive]}
          onPress={handleVoicePress}
          disabled={listening !== 'idle'}
        >
          {listening === 'processing' ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <Text style={styles.voiceIcon}>
              {listening === 'listening' ? '🔴' : '🎙️'}
            </Text>
          )}
        </TouchableOpacity>
      </Animated.View>

      <Text style={styles.hint}>
        {listening === 'idle' ? 'Нажми и говори' :
         listening === 'listening' ? 'Слушаю...' : 'Думаю...'}
      </Text>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  header: {
    marginTop: 40,
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 16,
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: { backgroundColor: '#10B981' },
  dotYellow: { backgroundColor: '#F59E0B' },
  dotRed: { backgroundColor: '#EF4444' },
  statusText: {
    color: '#D1D5DB',
    fontSize: 15,
    flex: 1,
  },
  connectBtn: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  connectBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  queryCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 12,
  },
  queryLabel: { color: '#6B7280', fontSize: 12, marginBottom: 4 },
  queryText: { color: '#E5E7EB', fontSize: 15, fontStyle: 'italic' },
  responseCard: {
    backgroundColor: '#1A1A2E',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 'auto',
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
  },
  responseLabel: { color: '#3B82F6', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  responseText: { color: '#F9FAFB', fontSize: 17, lineHeight: 26 },
  voiceButtonWrapper: {
    marginBottom: 16,
  },
  voiceButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  voiceButtonActive: {
    backgroundColor: '#1D4ED8',
  },
  voiceIcon: {
    fontSize: 40,
  },
  hint: {
    color: '#4B5563',
    fontSize: 14,
    marginBottom: 40,
  },
});
