/**
 * ChatScreen.tsx — Jarvis Chat Interface v3
 * 
 * Мультимедийный чат с поддержкой:
 *   - Текстовые сообщения через jarvisApi
 *   - Фото (камера/галерея) → upload → Vision AI анализ
 *   - Аудио записи (планируется)
 *   - Стриминговый индикатор "думает..."
 *   - Pull-to-refresh для переподключения
 *   - HUD тема с glassmorphism
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Image,
  Keyboard, ActionSheetIOS, Alert, RefreshControl,
  Animated, Easing, Dimensions,
} from 'react-native';
import { jarvisApi } from '../services/jarvisApiService';
import { mediaUploader } from '../services/media/MediaUploader';

// ─── Типы сообщений ──────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'image' | 'audio';
  text: string;
  mediaUri?: string;        // локальный URI для изображений/аудио
  mediaThumbnail?: string;  // превью для изображений
  analysisText?: string;    // результат Vision AI
  timestamp: number;
}

// Предпросмотр перед отправкой
interface MediaPreview {
  uri: string;
  mimeType: string;
  type: 'image' | 'audio';
}

// ─── Тема HUD ────────────────────────────────────────────────

const CYAN    = '#00C2FF';
const DARK_BG = '#040810';
const CARD_BG = 'rgba(10,14,26,0.95)';
const BORDER  = 'rgba(0,194,255,0.12)';
const CARD_BUBBLE = 'rgba(255,255,255,0.06)';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Компонент стриминговых точек ─────────────────────────────

const StreamingDots: React.FC = () => {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createPulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );

    Animated.parallel([
      createPulse(dot1, 0),
      createPulse(dot2, 150),
      createPulse(dot3, 300),
    ]).start();
  }, []);

  return (
    <View style={styles.dotsContainer}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { opacity: dot, transform: [{ scale: dot }] },
          ]}
        />
      ))}
    </View>
  );
};

// ─── Компонент пузыря изображения ─────────────────────────────

const ImageBubble: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <View style={[
      styles.bubble,
      isUser ? styles.userBubble : styles.assistantBubble,
      styles.imageBubble,
    ]}>
      {!isUser && <Text style={styles.assistantLabel}>◈ Jarvis Vision</Text>}

      {/* Превью изображения */}
      {message.mediaUri && (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: message.mediaUri }}
            style={styles.messageImage}
            resizeMode="cover"
          />
        </View>
      )}

      {/* Текст сообщения (caption или статус) */}
      {!!message.text && (
        <Text style={[
          styles.bubbleText,
          isUser ? styles.userText : styles.assistantText,
        ]}>
          {message.text}
        </Text>
      )}

      {/* Результат анализа Vision AI */}
      {!!message.analysisText && (
        <View style={styles.analysisContainer}>
          <Text style={styles.analysisLabel}>🔍 Vision AI</Text>
          <Text style={styles.analysisText}>{message.analysisText}</Text>
        </View>
      )}

      <Text style={styles.timestamp}>
        {new Date(message.timestamp).toLocaleTimeString('ru', {
          hour: '2-digit', minute: '2-digit',
        })}
      </Text>
    </View>
  );
};

// ─── Компонент аудио пузыря ───────────────────────────────────

const AudioBubble: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === 'user';
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = () => {
    // TODO: подключить react-native-audio-recorder-player
    setIsPlaying(!isPlaying);
  };

  return (
    <View style={[
      styles.bubble,
      isUser ? styles.userBubble : styles.assistantBubble,
    ]}>
      {!isUser && <Text style={styles.assistantLabel}>◈ Jarvis</Text>}

      <TouchableOpacity style={styles.audioRow} onPress={togglePlay}>
        <Text style={styles.audioPlayBtn}>{isPlaying ? '⏸' : '▶️'}</Text>
        {/* Визуализация формы волны */}
        <View style={styles.waveformContainer}>
          {Array.from({ length: 20 }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.waveformBar,
                {
                  height: 4 + Math.random() * 16,
                  backgroundColor: isUser ? 'rgba(0,0,0,0.4)' : CYAN,
                },
              ]}
            />
          ))}
        </View>
      </TouchableOpacity>

      {/* Транскрипция */}
      {!!message.text && (
        <Text style={[
          styles.bubbleText,
          isUser ? styles.userText : styles.assistantText,
          styles.transcriptionText,
        ]}>
          {message.text}
        </Text>
      )}

      <Text style={styles.timestamp}>
        {new Date(message.timestamp).toLocaleTimeString('ru', {
          hour: '2-digit', minute: '2-digit',
        })}
      </Text>
    </View>
  );
};

// ─── Главный компонент ChatScreen ─────────────────────────────

export function ChatScreen() {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [inputText, setInputText]   = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [apiStatus, setApiStatus]   = useState<'checking' | 'online' | 'offline'>('checking');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ─── Инициализация ──────────────────────────────────────────

  useEffect(() => {
    initServices();
  }, []);

  const initServices = async () => {
    await jarvisApi.init();
    await mediaUploader.init();
    const ok = await jarvisApi.healthCheck();
    setApiStatus(ok ? 'online' : 'offline');
    if (ok) {
      addSystemMessage('◈ Jarvis подключён. Отправляй текст, фото или голос.');
    } else {
      addSystemMessage('⚠️ Нет связи с сервером. Потяни вниз для переподключения.');
    }
  };

  // Приём голосовых сообщений из HomeScreen
  useEffect(() => {
    const { DeviceEventEmitter } = require('react-native');
    const sub = DeviceEventEmitter.addListener('VOICE_MESSAGE', (text: string) => {
      sendTextMessage(text);
    });
    return () => sub.remove();
  }, []);

  // ─── Хелперы для сообщений ──────────────────────────────────

  const generateId = () => Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8);

  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const full: Message = {
      ...msg,
      id: generateId(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, full]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return full;
  }, []);

  const addSystemMessage = useCallback((text: string) => {
    addMessage({ role: 'system', type: 'text', text });
  }, [addMessage]);

  const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages(prev =>
      prev.map(m => m.id === id ? { ...m, ...updates } : m),
    );
  }, []);

  // ─── Отправка текстового сообщения ──────────────────────────

  const sendTextMessage = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? inputText).trim();
    if (!text || isThinking) return;
    setInputText('');
    Keyboard.dismiss();

    addMessage({ role: 'user', type: 'text', text });
    setIsThinking(true);

    try {
      const reply = await jarvisApi.chat(text);
      addMessage({ role: 'assistant', type: 'text', text: reply });
      setApiStatus('online');
    } catch (e: any) {
      addMessage({
        role: 'assistant',
        type: 'text',
        text: `⚠️ ${e.message ?? 'Ошибка соединения'}`,
      });
      setApiStatus('offline');
    } finally {
      setIsThinking(false);
    }
  }, [inputText, isThinking, addMessage]);

  // ─── Отправка изображения ───────────────────────────────────

  const sendImageMessage = useCallback(async () => {
    if (!mediaPreview || mediaPreview.type !== 'image') return;
    const { uri, mimeType } = mediaPreview;
    setMediaPreview(null);
    setIsThinking(true);

    // Добавляем сообщение пользователя с изображением
    const userMsg = addMessage({
      role: 'user',
      type: 'image',
      text: '📷 Фото отправлено',
      mediaUri: uri,
    });

    try {
      // Загружаем и анализируем через MediaUploader
      const analysis = await mediaUploader.uploadAndAnalyze(
        { uri, mimeType },
        'Подробно опиши что ты видишь на этом изображении. Ответь на русском.',
      );

      addMessage({
        role: 'assistant',
        type: 'image',
        text: '',
        mediaUri: uri,
        analysisText: analysis,
      });
      setApiStatus('online');
    } catch (e: any) {
      addMessage({
        role: 'assistant',
        type: 'text',
        text: `⚠️ Ошибка анализа: ${e.message}`,
      });
    } finally {
      setIsThinking(false);
    }
  }, [mediaPreview, addMessage]);

  // ─── Действие отправки (текст или медиа) ───────────────────

  const handleSend = useCallback(() => {
    if (mediaPreview) {
      sendImageMessage();
    } else {
      sendTextMessage();
    }
  }, [mediaPreview, sendImageMessage, sendTextMessage]);

  // ─── Вложения: камера / галерея / аудио ─────────────────────

  const handleAttachPress = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Отмена', '📷 Камера', '🖼️ Галерея', '🎤 Голосовое'],
          cancelButtonIndex: 0,
          title: 'Прикрепить медиа',
          tintColor: CYAN,
        },
        (buttonIndex) => {
          switch (buttonIndex) {
            case 1: openCamera(); break;
            case 2: openGallery(); break;
            case 3: startVoiceRecord(); break;
          }
        },
      );
    } else {
      // Android fallback — простое Alert меню
      Alert.alert('Прикрепить медиа', '', [
        { text: '📷 Камера', onPress: openCamera },
        { text: '🖼️ Галерея', onPress: openGallery },
        { text: '🎤 Голосовое', onPress: startVoiceRecord },
        { text: 'Отмена', style: 'cancel' },
      ]);
    }
  };

  const openCamera = async () => {
    try {
      // Используем react-native-image-picker (launchCamera)
      const ImagePicker = require('react-native-image-picker');
      const result = await ImagePicker.launchCamera({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1920,
        maxHeight: 1920,
        saveToPhotos: false,
      });

      if (result.didCancel || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setMediaPreview({
        uri: asset.uri!,
        mimeType: asset.type || 'image/jpeg',
        type: 'image',
      });
    } catch (e: any) {
      console.warn('[ChatScreen] Camera error:', e.message);
      Alert.alert('Ошибка камеры', e.message);
    }
  };

  const openGallery = async () => {
    try {
      const ImagePicker = require('react-native-image-picker');
      const result = await ImagePicker.launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1920,
        maxHeight: 1920,
        selectionLimit: 1,
      });

      if (result.didCancel || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setMediaPreview({
        uri: asset.uri!,
        mimeType: asset.type || 'image/jpeg',
        type: 'image',
      });
    } catch (e: any) {
      console.warn('[ChatScreen] Gallery error:', e.message);
      Alert.alert('Ошибка галереи', e.message);
    }
  };

  const startVoiceRecord = () => {
    // TODO: Интеграция с react-native-audio-recorder-player
    addSystemMessage('🎤 Запись голоса будет добавлена в следующем обновлении.');
  };

  // ─── Очистка истории ────────────────────────────────────────

  const handleClearHistory = async () => {
    await jarvisApi.clearSession();
    setMessages([]);
    addSystemMessage('◈ История очищена. Новая сессия начата.');
  };

  // ─── Pull-to-refresh ────────────────────────────────────────

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await jarvisApi.init();
    await mediaUploader.init();
    const ok = await jarvisApi.healthCheck();
    const mediaOk = await mediaUploader.healthCheck();
    setApiStatus(ok ? 'online' : 'offline');

    if (ok) {
      addSystemMessage(`◈ Переподключено. API: ✅ | Медиа: ${mediaOk ? '✅' : '❌'}`);
      // Попытка отправить офлайн-очередь
      const retried = await mediaUploader.retryOfflineQueue();
      if (retried > 0) {
        addSystemMessage(`📤 Отправлено из очереди: ${retried} файл(ов)`);
      }
    } else {
      addSystemMessage('⚠️ Сервер всё ещё недоступен.');
    }
    setIsRefreshing(false);
  };

  // ─── Отмена превью ──────────────────────────────────────────

  const cancelPreview = () => setMediaPreview(null);

  // ─── Рендер сообщения ───────────────────────────────────────

  const renderMessage = (msg: Message) => {
    // Изображения
    if (msg.type === 'image') {
      return <ImageBubble key={msg.id} message={msg} />;
    }

    // Аудио
    if (msg.type === 'audio') {
      return <AudioBubble key={msg.id} message={msg} />;
    }

    // Текст / системные
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';

    return (
      <View
        key={msg.id}
        style={[
          styles.bubble,
          isSystem
            ? styles.systemBubble
            : isUser
              ? styles.userBubble
              : styles.assistantBubble,
        ]}
      >
        {msg.role === 'assistant' && (
          <Text style={styles.assistantLabel}>◈ Jarvis</Text>
        )}
        {isSystem && (
          <Text style={styles.systemLabel}>⚙️ System</Text>
        )}
        <Text style={[
          styles.bubbleText,
          isUser
            ? styles.userText
            : isSystem
              ? styles.systemText
              : styles.assistantText,
        ]}>
          {msg.text}
        </Text>
        <Text style={styles.timestamp}>
          {new Date(msg.timestamp).toLocaleTimeString('ru', {
            hour: '2-digit', minute: '2-digit',
          })}
        </Text>
      </View>
    );
  };

  // ─── Статус-бар ─────────────────────────────────────────────

  const statusColor = apiStatus === 'online' ? '#00FF88'
                    : apiStatus === 'offline' ? '#FF4444'
                    : '#FFAA00';
  const statusLabel = apiStatus === 'online'  ? 'Online'
                    : apiStatus === 'offline' ? 'Offline'
                    : '...';

  const canSend = mediaPreview
    ? !isThinking
    : (!!inputText.trim() && !isThinking);

  // ─── Рендер ─────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Шапка */}
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

      {/* Список сообщений */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ paddingVertical: 16 }}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
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
        {messages.map(renderMessage)}

        {/* Индикатор "думает" со стриминговыми точками */}
        {isThinking && (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <Text style={styles.assistantLabel}>◈ Jarvis</Text>
            <View style={styles.thinkingRow}>
              <StreamingDots />
              <Text style={styles.thinkingText}>Обрабатываю...</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Превью вложения перед отправкой */}
      {mediaPreview && (
        <View style={styles.previewContainer}>
          {mediaPreview.type === 'image' && (
            <Image
              source={{ uri: mediaPreview.uri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          )}
          {mediaPreview.type === 'audio' && (
            <View style={styles.previewAudioBadge}>
              <Text style={styles.previewAudioText}>🎤 Голосовое сообщение</Text>
            </View>
          )}
          <TouchableOpacity style={styles.previewCancelBtn} onPress={cancelPreview}>
            <Text style={styles.previewCancelText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Ввод сообщения */}
      <View style={styles.inputRow}>
        {/* Кнопка вложения */}
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={handleAttachPress}
          disabled={isThinking}
        >
          <Text style={[styles.attachBtnText, isThinking && { opacity: 0.3 }]}>📎</Text>
        </TouchableOpacity>

        {/* Поле ввода */}
        <TextInput
          style={styles.input}
          placeholder={mediaPreview ? 'Добавь подпись...' : 'Напиши Jarvis...'}
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => handleSend()}
          returnKeyType="send"
          multiline
          maxLength={2000}
        />

        {/* Кнопка отправки */}
        <TouchableOpacity
          style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!canSend}
        >
          <Text style={styles.sendBtnText}>
            {mediaPreview ? '📤' : '▶'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// Совместимость с default import (на случай если где-то используется)
export default ChatScreen;

// ─── Стили ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  // Шапка
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: CARD_BG,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  statusText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  clearBtnText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
  },

  // Сообщения
  messages: {
    flex: 1,
    paddingHorizontal: 12,
  },

  // Пузыри
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    padding: 12,
    marginVertical: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: CYAN,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: 'rgba(0,194,255,0.2)',
    borderBottomLeftRadius: 4,
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    maxWidth: '90%',
  },
  imageBubble: {
    padding: 8,
    maxWidth: '85%',
  },
  assistantLabel: {
    color: CYAN,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  systemLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: '#000000',
  },
  assistantText: {
    color: 'rgba(255,255,255,0.9)',
  },
  systemText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    textAlign: 'center',
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 4,
    alignSelf: 'flex-end',
  },

  // Изображение в сообщении
  imageContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  messageImage: {
    width: SCREEN_WIDTH * 0.65,
    height: SCREEN_WIDTH * 0.5,
    borderRadius: 12,
  },

  // Vision AI анализ
  analysisContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,194,255,0.15)',
  },
  analysisLabel: {
    color: CYAN,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  analysisText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    lineHeight: 20,
  },

  // Аудио
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  audioPlayBtn: {
    fontSize: 20,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
    height: 24,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
  },
  transcriptionText: {
    marginTop: 6,
    fontStyle: 'italic',
    opacity: 0.8,
  },

  // Индикатор "думает"
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thinkingText: {
    color: CYAN,
    fontSize: 13,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: CYAN,
  },

  // Превью вложения
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CARD_BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  previewAudioBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,194,255,0.1)',
    borderWidth: 1,
    borderColor: BORDER,
  },
  previewAudioText: {
    color: CYAN,
    fontSize: 13,
  },
  previewCancelBtn: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,68,68,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,68,68,0.3)',
  },
  previewCancelText: {
    color: '#FF4444',
    fontSize: 16,
    fontWeight: '700',
  },

  // Ввод
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: CARD_BG,
    gap: 6,
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,194,255,0.08)',
    borderWidth: 1,
    borderColor: BORDER,
  },
  attachBtnText: {
    fontSize: 20,
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 15,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(0,194,255,0.2)',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CYAN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
  },
});
