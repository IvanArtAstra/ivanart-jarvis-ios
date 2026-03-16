/**
 * ChatScreen.tsx — Jarvis Chat Interface
 * Chat bubbles + text input + voice button
 * Connected to jarvis_ios_bridge.py via AgentBridgeService
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  Keyboard,
} from 'react-native';
import { agentBridgeService } from '../services/agentBridgeService';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const BLUE = '#3B82F6';
const DARK_BG = '#0A0A0F';
const CARD_BG = '#13131F';
const JARVIS_BUBBLE = '#1A1A2E';
const USER_BUBBLE = '#1D4ED8';

export const ChatScreen = () => {
  const [messages, setMessages] = useState<Message[]>([{
    id: 'welcome',
    role: 'assistant',
    text: 'Привет! Я Jarvis. Напиши или скажи что-нибудь.',
    timestamp: Date.now(),
  }]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // ─── Connect to Bridge ────────────────────────────────────
  useEffect(() => {
    agentBridgeService.connect((connected) => {
      setIsConnected(connected);
    });

    // Listen for responses
    const handleResponse = (data: any) => {
      const msg: Message = {
        id: `j_${Date.now()}`,
        role: 'assistant',
        text: data.text,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, msg]);
      setIsThinking(false);
    };

    const handleState = (data: any) => {
      if (data.state === 'thinking') setIsThinking(true);
      else if (data.state === 'idle') setIsThinking(false);
    };

    agentBridgeService.on('response', handleResponse);
    agentBridgeService.on('state', handleState);

    return () => {
      agentBridgeService.off('response', handleResponse);
      agentBridgeService.off('state', handleState);
    };
  }, []);

  // ─── Auto-scroll ──────────────────────────────────────────
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, isThinking]);

  // ─── Send Message ─────────────────────────────────────────
  const sendMessage = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;

    const msg: Message = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    setInputText('');
    Keyboard.dismiss();

    if (isConnected) {
      agentBridgeService.send('chat', { text });
    } else {
      // Offline fallback message
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: `j_${Date.now()}`,
          role: 'assistant',
          text: 'Нет подключения к Bridge. Проверь Settings → Bridge URL.',
          timestamp: Date.now(),
        }]);
      }, 500);
    }
  }, [inputText, isConnected]);

  // ─── Clear History ────────────────────────────────────────
  const clearChat = useCallback(() => {
    setMessages([{
      id: 'cleared',
      role: 'assistant',
      text: 'История очищена. Начнём заново!',
      timestamp: Date.now(),
    }]);
  }, []);

  // ─── Render ───────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerIcon}>◈</Text>
          <View>
            <Text style={styles.headerTitle}>JARVIS CHAT</Text>
            <View style={styles.statusRow}>
              <View style={[styles.dot, isConnected ? styles.dotGreen : styles.dotRed]} />
              <Text style={styles.statusText}>
                {isConnected ? 'Connected' : 'Offline'}
              </Text>
            </View>
          </View>
        </View>
        <TouchableOpacity onPress={clearChat} style={styles.clearBtn}>
          <Text style={styles.clearText}>🗑</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map(msg => (
          <View
            key={msg.id}
            style={[
              styles.bubble,
              msg.role === 'user' ? styles.userBubble : styles.jarvisBubble,
            ]}
          >
            {msg.role === 'assistant' && (
              <Text style={styles.bubbleLabel}>◈ JARVIS</Text>
            )}
            {msg.role === 'user' && (
              <Text style={styles.bubbleLabelUser}>🗣 ТЫ</Text>
            )}
            <Text style={[
              styles.bubbleText,
              msg.role === 'user' && styles.userBubbleText,
            ]}>
              {msg.text}
            </Text>
            <Text style={styles.timestamp}>
              {new Date(msg.timestamp).toLocaleTimeString('ru-RU', {
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>
        ))}

        {/* Typing indicator */}
        {isThinking && (
          <View style={[styles.bubble, styles.jarvisBubble]}>
            <Text style={styles.bubbleLabel}>◈ JARVIS</Text>
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={BLUE} />
              <Text style={styles.thinkingText}>Думаю...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Напиши Jarvis..."
          placeholderTextColor="#4B5563"
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          multiline={false}
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!inputText.trim()}
        >
          <Text style={styles.sendIcon}>▶</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A2E',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    fontSize: 24,
    color: BLUE,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#F9FAFB',
    letterSpacing: 1.5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotGreen: { backgroundColor: '#10B981' },
  dotRed: { backgroundColor: '#EF4444' },
  statusText: {
    fontSize: 10,
    color: '#6B7280',
  },
  clearBtn: {
    padding: 8,
  },
  clearText: {
    fontSize: 20,
  },

  // Messages
  messageList: {
    flex: 1,
  },
  messageContent: {
    padding: 16,
    paddingBottom: 8,
  },

  // Bubbles
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  jarvisBubble: {
    backgroundColor: JARVIS_BUBBLE,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: USER_BUBBLE,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: BLUE,
    letterSpacing: 1,
    marginBottom: 4,
  },
  bubbleLabelUser: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    marginBottom: 4,
  },
  bubbleText: {
    fontSize: 15,
    color: '#E5E7EB',
    lineHeight: 22,
  },
  userBubbleText: {
    color: '#FFFFFF',
  },
  timestamp: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.2)',
    marginTop: 6,
    textAlign: 'right',
  },

  // Thinking
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thinkingText: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: 34, // Safe area
    borderTopWidth: 1,
    borderTopColor: '#1A1A2E',
    backgroundColor: '#0D0D15',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: CARD_BG,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#F9FAFB',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BLUE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#1F2937',
  },
  sendIcon: {
    color: '#FFFFFF',
    fontSize: 16,
    marginLeft: 2,
  },
});
