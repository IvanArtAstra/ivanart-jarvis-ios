/**
 * ChatScreen.tsx — Jarvis Chat Interface v2
 * Uses HTTP API (jarvisApiService) — no keys in app
 * iOS → POST /api/chat → Jarvis server → reply
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Keyboard,
} from 'react-native';
import { jarvisApi } from '../services/jarvisApiService';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const CYAN   = '#00C2FF';
const DARK   = '#0A0E1A';
const CARD   = 'rgba(255,255,255,0.06)';

export default function ChatScreen() {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [inputText, setInputText]   = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [apiStatus, setApiStatus]   = useState<'checking'|'online'|'offline'>('checking');
  const scrollRef = useRef<ScrollView>(null);

  // Init: connect to API and check health
  useEffect(() => {
    const init = async () => {
      await jarvisApi.init();
      const ok = await jarvisApi.healthCheck();
      setApiStatus(ok ? 'online' : 'offline');
      if (ok) {
        addMessage('assistant', '◈ Jarvis подключён. Чем могу помочь?');
      } else {
        addMessage('assistant', '⚠️ Нет связи с сервером. Проверь настройки API URL.');
      }
    };
    init();
  }, []);

  // Also receive voice messages from HomeScreen via global event
  useEffect(() => {
    const { DeviceEventEmitter } = require('react-native');
    const sub = DeviceEventEmitter.addListener('VOICE_MESSAGE', (text: string) => {
      sendMessage(text);
    });
    return () => sub.remove();
  }, []);

  const addMessage = (role: 'user' | 'assistant', text: string) => {
    const msg: Message = {
      id: Date.now().toString() + Math.random(),
      role, text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return msg;
  };

  const sendMessage = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? inputText).trim();
    if (!text || isThinking) return;
    setInputText('');
    Keyboard.dismiss();

    addMessage('user', text);
    setIsThinking(true);

    try {
      const reply = await jarvisApi.chat(text);
      addMessage('assistant', reply);
      // Re-check status on success
      setApiStatus('online');
    } catch (e: any) {
      addMessage('assistant', `⚠️ ${e.message ?? 'Ошибка соединения'}`);
      setApiStatus('offline');
    } finally {
      setIsThinking(false);
    }
  }, [inputText, isThinking]);

  const handleClearHistory = async () => {
    await jarvisApi.clearSession();
    setMessages([]);
    addMessage('assistant', '◈ История очищена. Новая сессия начата.');
  };

  const statusColor = apiStatus === 'online' ? '#00FF88'
                    : apiStatus === 'offline' ? '#FF4444'
                    : '#FFAA00';
  const statusLabel = apiStatus === 'online'   ? 'Online'
                    : apiStatus === 'offline'  ? 'Offline'
                    : '...';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.headerTitle}>Jarvis</Text>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        <TouchableOpacity onPress={handleClearHistory} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Очистить</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ paddingVertical: 16 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map(msg => (
          <View
            key={msg.id}
            style={[
              styles.bubble,
              msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            {msg.role === 'assistant' && (
              <Text style={styles.assistantLabel}>◈ Jarvis</Text>
            )}
            <Text style={[
              styles.bubbleText,
              msg.role === 'user' ? styles.userText : styles.assistantText,
            ]}>
              {msg.text}
            </Text>
            <Text style={styles.timestamp}>
              {new Date(msg.timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        ))}

        {isThinking && (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <Text style={styles.assistantLabel}>◈ Jarvis</Text>
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={CYAN} />
              <Text style={styles.thinkingText}>Обрабатываю...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Напиши Jarvis..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => sendMessage()}
          returnKeyType="send"
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || isThinking) && styles.sendBtnDisabled]}
          onPress={() => sendMessage()}
          disabled={!inputText.trim() || isThinking}
        >
          <Text style={styles.sendBtnText}>▶</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DARK },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,194,255,0.15)',
  },
  headerLeft:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot:     { width: 8, height: 8, borderRadius: 4 },
  headerTitle:   { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  statusText:    { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  clearBtn:      { paddingHorizontal: 10, paddingVertical: 4,
                   borderRadius: 8, borderWidth: 1,
                   borderColor: 'rgba(255,255,255,0.15)' },
  clearBtnText:  { color: 'rgba(255,255,255,0.5)', fontSize: 12 },

  messages: { flex: 1, paddingHorizontal: 12 },

  bubble: {
    maxWidth: '82%', borderRadius: 16, padding: 12,
    marginVertical: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: CYAN,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: CARD,
    borderWidth: 1, borderColor: 'rgba(0,194,255,0.2)',
    borderBottomLeftRadius: 4,
  },
  assistantLabel: { color: CYAN, fontSize: 11, fontWeight: '700',
                    marginBottom: 4, letterSpacing: 0.5 },
  bubbleText:     { fontSize: 15, lineHeight: 22 },
  userText:       { color: '#000000' },
  assistantText:  { color: 'rgba(255,255,255,0.9)' },
  timestamp:      { fontSize: 10, color: 'rgba(255,255,255,0.3)',
                    marginTop: 4, alignSelf: 'flex-end' },

  thinkingRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText:  { color: CYAN, fontSize: 13 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(0,194,255,0.15)',
    gap: 8,
  },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    color: '#FFFFFF', fontSize: 15, maxHeight: 100,
    borderWidth: 1, borderColor: 'rgba(0,194,255,0.2)',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: CYAN, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText:     { color: '#000', fontSize: 18, fontWeight: '700' },
});
