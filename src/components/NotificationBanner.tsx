/**
 * NotificationBanner — анимированный баннер уведомлений
 *
 * Слайд сверху при foreground push-уведомлении.
 * Glassmorphism + cyan accent, auto-dismiss через 4с.
 * Свайп вверх для закрытия, тап для действия.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  Animated,
  PanResponder,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PushService, {
  JarvisNotification,
  NotificationType,
} from '../services/notifications/PushService';

// ── Тема ────────────────────────────────────────────────────

const COLORS = {
  bg: 'rgba(4, 8, 16, 0.92)',
  bgBorder: 'rgba(0, 194, 255, 0.25)',
  cyan: '#00C2FF',
  text: '#E8EDF5',
  muted: '#3A4456',
  shadow: 'rgba(0, 194, 255, 0.15)',
};

const BANNER_HEIGHT = 90;
const AUTO_DISMISS_MS = 4000;

// ── Иконки по типу уведомления ──────────────────────────────

const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  agent_result: '🤖',
  morning_briefing: '☀️',
  alert: '🚨',
  reminder: '⏰',
  message: '💬',
};

// ── Компонент ───────────────────────────────────────────────

interface NotificationBannerProps {
  /** Callback при тапе на уведомление */
  onTap?: (notification: JarvisNotification) => void;
}

export const NotificationBanner: React.FC<NotificationBannerProps> = ({ onTap }) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-(BANNER_HEIGHT + insets.top + 20))).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notification, setNotification] = useState<JarvisNotification | null>(null);
  const [visible, setVisible] = useState(false);

  // Скрыть баннер с анимацией
  const hideBanner = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -(BANNER_HEIGHT + insets.top + 20),
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      setNotification(null);
    });
  }, [insets.top]);

  // Показать баннер
  const showBanner = useCallback(
    (notif: JarvisNotification) => {
      // Не показываем tapped-уведомления (пользователь уже тапнул)
      if (notif.data?._tapped === 'true') return;

      setNotification(notif);
      setVisible(true);

      // Анимация появления
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 80,
          friction: 12,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(hideBanner, AUTO_DISMISS_MS);
    },
    [hideBanner],
  );

  // Свайп вверх для закрытия
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Только вертикальный свайп вверх
        return gestureState.dy < -10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy < 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy < -30 || gestureState.vy < -0.5) {
          hideBanner();
        } else {
          // Вернуть на место
          Animated.spring(translateY, {
            toValue: 0,
            tension: 80,
            friction: 12,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // Подписка на push
  useEffect(() => {
    const unsubscribe = PushService.getInstance().onNotification(showBanner);
    return () => {
      unsubscribe();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [showBanner]);

  // Тап
  const handleTap = useCallback(() => {
    if (notification && onTap) {
      onTap(notification);
    }
    hideBanner();
  }, [notification, onTap, hideBanner]);

  if (!visible && !notification) return null;

  const icon = notification
    ? NOTIFICATION_ICONS[notification.type] ?? '📱'
    : '📱';

  return (
    <Animated.View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 8,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={styles.content}
        activeOpacity={0.8}
        onPress={handleTap}
      >
        {/* Иконка */}
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>{icon}</Text>
        </View>

        {/* Текст */}
        <View style={styles.textContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {notification?.title ?? ''}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {notification?.body ?? ''}
          </Text>
        </View>

        {/* Индикатор типа */}
        <View style={styles.indicator} />
      </TouchableOpacity>

      {/* Полоска для свайпа */}
      <View style={styles.swipeHint} />
    </Animated.View>
  );
};

// ── Стили (HUD glassmorphism) ───────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    // Тень с cyan-оттенком
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 10,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 194, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 22,
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  body: {
    fontSize: 13,
    color: COLORS.muted,
    lineHeight: 17,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.cyan,
    // Мерцание можно добавить через Animated
  },
  swipeHint: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.muted,
    alignSelf: 'center',
    marginTop: 6,
    opacity: 0.5,
  },
});

export default NotificationBanner;
