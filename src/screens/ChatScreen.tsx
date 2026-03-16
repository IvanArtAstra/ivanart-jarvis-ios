/**
 * ChatScreen — Jarvis Chat Interface
 * Real-time chat with Jarvis AI via WebSocket bridge
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet, KeyboardAvoidingView,
  Platform, Animated, SafeAreaView, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BRIDGE_URL_KEY = '@jarvis_bridge_url';
const DEFAULT_URL    = 'ws://100.70.68.84:8766';

type MsgRole = 'user' | 'jarvis' | 'system';

interface Message {
  id:        string;
  role:      MsgRole;
  text:      string;
  timestamp: number;
}

type BridgeState = 'disconnected' | 'connecting' | 'connected' | 'thinking';

export const ChatScreen = () => {
  const [messages,     setMessages]     = useState<Message[]>([{
    id: '0', role: 'jarvis',
    text: 'Привет. Я Jarvis. Чем могу помочь?',
    timestamp: Date.now(),
  }]);
  const [input,        setInput]        = useState('');
  const [bridgeState,  setBridgeState]  = useState<BridgeState>('disconnected');
  const [bridgeUrl,    setBridgeUrl]    = useState(DEFAULT_URL);

  const wsRef      = useRef<WebSocket | null>(null);
  const listRef    = useRef<FlatList>(null);
  const dotAnim    = useRef(new Animated.Value(0)).current;
  const reconnectT = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Typing dots animation
  useEffect(() => {
    if (bridgeState === 'thinking') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      dotAnim.setValue(0);
    }
  }, [bridgeState]);

  // Load URL + connect
  useEffect(() => {
    AsyncStorage.getItem(BRIDGE_URL_KEY).then(url => {
      const target = url || DEFAULT_URL;
      setBridgeUrl(target);
      connect(target);
    });
    return () => {
      wsRef.current?.close();
      if (reconnectT.current) clearTimeout(reconnectT.current);
    };
  }, []);

  const addMessage = useCallback((role: MsgRole, text: string) => {
    setMessages(prev => [...prev, {
      id: String(Date.now() + Math.random()),
      role, text,
      timestamp: Date.now(),
    }]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const connect = useCallback((url: string) => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    setBridgeState('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setBridgeState('connected');
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') {
          addMessage('system', '🔗 Мост подключён');
        } else if (data.type === 'state') {
          if (data.state === 'thinking') setBridgeState('thinking');
          else if (data.state === 'idle') setBridgeState('connected');
        } else if (data.type === 'response') {
          setBridgeState('connected');
          addMessage('jarvis', data.text);
        } else if (data.type === 'error') {
          addMessage('system', `⚠️ ${data.message}`);
        }
      } catch {}
    };

    ws.onerror = () => {
      setBridgeState('disconnected');
    };

    ws.onclose = () => {
      setBridgeState('disconnected');
      reconnectT.current = setTimeout(() => connect(url), 5000);
    };
  }, [addMessage]);

  const sendMessage = useCallback((text: string) => {
    const msg = text.trim();
    if (!msg) return;

    addMessage('user', msg);
    setInput('');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: msg }));
      setBridgeState('thinking');
    } else {
      addMessage('system', '⚠️ Мост не подключён. Переподключение...');
      connect(bridgeUrl);
    }
  }, [addMessage, bridgeUrl, connect]);

  const renderMessage = ({ item }: { item: Message }) => {
    if (item.role === 'system') {
      return (
        <View style={styles.systemMsgRow}>
          <Text style={styles.systemMsg}>{item.text}</Text>
        </View>
      );
    }

    const isUser = item.role === 'user';
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowJarvis]}>
        {!isUser && <Text style={styles.jarvisLabel}>◈</Text>}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleJarvis]}>
          <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextJarvis]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  const stateColor = {
    disconnected: '#374151',
    connecting:   '#F59E0B',
    connected:    '#00D4A0',
    thinking:     '#A855F7',
  }[bridgeState];

  const stateLabel = {
    disconnected: 'Не подключён',
    connecting:   'Подключение...',
    connected:    'Готов',
    thinking:     'Думает...',
  }[bridgeState];

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>◈ <Text style={styles.titleAccent}>JARVIS</Text> CHAT</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: stateColor }]} />
          <Text style={[styles.statusText, { color: stateColor }]}>{stateLabel}</Text>
          {bridgeState === 'disconnected' && (
            <TouchableOpacity onPress={() => connect(bridgeUrl)} style={styles.reconnectBtn}>
              <Text style={styles.reconnectText}>Подключить</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        showsVerticalScrollIndicator={false}
      />

      {/* Typing indicator */}
      {bridgeState === 'thinking' && (
        <View style={styles.typingRow}>
          <Text style={styles.jarvisLabel}>◈</Text>
          <View style={styles.typingBubble}>
            {[0, 1, 2].map(i => (
              <Animated.View key={i} style={[styles.typingDot, {
                opacity: dotAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: i === 1 ? [0.3, 1] : [0.6, 0.3],
                }),
                transform: [{
                  translateY: dotAnim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: i === 1 ? [0, -4, 0] : [0, -2, 0],
                  }),
                }],
              }]} />
            ))}
          </View>
        </View>
      )}

      {/* Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={88}
      >
        <View style={styles.inputArea}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Спроси Jarvis..."
            placeholderTextColor="#3A4456"
            multiline
            maxLength={500}
            onSubmitEditing={() => sendMessage(input)}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, { opacity: input.trim() ? 1 : 0.4 }]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || bridgeState === 'thinking'}
          >
            {bridgeState === 'thinking'
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={styles.sendIcon}>↑</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
};

const BG      = '#040810';
const CARD    = 'rgba(10,14,26,0.95)';
const BORDER  = 'rgba(0,194,255,0.12)';
const CYAN    = '#00C2FF';
const TEXT    = '#E8EDF5';
const MUTED   = '#3A4456';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  title: { fontSize: 16, fontWeight: '700', color: TEXT, letterSpacing: 2 },
  titleAccent: { color: CYAN },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  reconnectBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  reconnectText: { color: CYAN, fontSize: 11 },

  listContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4 },
  msgRowUser:   { justifyContent: 'flex-end' },
  msgRowJarvis: { justifyContent: 'flex-start' },

  jarvisLabel: { color: CYAN, fontSize: 14, marginBottom: 4 },

  bubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: '#00C2FF',
    borderBottomRightRadius: 4,
  },
  bubbleJarvis: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: 'rgba(0,194,255,0.18)',
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser:   { color: '#000', fontWeight: '500' },
  bubbleTextJarvis: { color: TEXT },

  systemMsgRow: { alignItems: 'center', marginVertical: 4 },
  systemMsg: { color: MUTED, fontSize: 11, fontStyle: 'italic' },

  typingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  typingBubble: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: 'rgba(0,194,255,0.18)',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: CYAN,
  },

  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: 'rgba(4,8,16,0.95)',
  },
  input: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: TEXT,
    fontSize: 15,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: CYAN,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendIcon: { color: '#000', fontSize: 20, fontWeight: '700', marginTop: -2 },
});
