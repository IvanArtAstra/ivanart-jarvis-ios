/**
 * GlassCard.tsx — Компонент карточки с эффектом glassmorphism
 * 
 * Особенности:
 *   - Полупрозрачный фон с размытием (BlurView или CSS-fallback)
 *   - Тонкая светящаяся граница с анимацией при появлении
 *   - Мягкий glow-эффект на mount
 *   - Полностью кастомизируемый через пропсы
 * 
 * Использование:
 *   <GlassCard blurAmount={12} glowColor="#00C2FF">
 *     <Text>Контент</Text>
 *   </GlassCard>
 */

import React, { useEffect } from 'react';
import { View, ViewStyle, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';

/** Пропсы компонента GlassCard */
interface GlassCardProps {
  /** Дочерние элементы */
  children: React.ReactNode;
  /** Дополнительные стили контейнера */
  style?: ViewStyle;
  /** Интенсивность размытия (1-20, по умолчанию 12) */
  blurAmount?: number;
  /** Цвет границы (по умолчанию BORDER) */
  borderColor?: string;
  /** Цвет свечения (по умолчанию CYAN) */
  glowColor?: string;
  /** Радиус скругления (по умолчанию 20) */
  borderRadius?: number;
  /** Отключить анимацию свечения */
  disableGlow?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  style,
  blurAmount = 12,
  borderColor = COLORS.BORDER,
  glowColor = COLORS.CYAN,
  borderRadius = 20,
  disableGlow = false,
}) => {
  // Прогресс анимации появления (0 → 1)
  const mountProgress = useSharedValue(0);
  // Пульсация свечения границы (0 → 1 → 0, бесконечный цикл)
  const glowPulse = useSharedValue(0);

  useEffect(() => {
    // Анимация появления — плавное нарастание за 600мс
    mountProgress.value = withTiming(1, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });

    // Бесконечная пульсация свечения границы
    if (!disableGlow) {
      glowPulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sine) }),
          withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.sine) }),
        ),
        -1, // бесконечный повтор
        false,
      );
    }
  }, []);

  // Анимированный стиль контейнера — opacity + масштаб при появлении
  const animatedContainer = useAnimatedStyle(() => ({
    opacity: mountProgress.value,
    transform: [
      { scale: interpolate(mountProgress.value, [0, 1], [0.97, 1]) },
    ],
  }));

  // Анимированный стиль границы — пульсирующее свечение
  const animatedBorder = useAnimatedStyle(() => {
    const glowOpacity = interpolate(glowPulse.value, [0, 1], [0.12, 0.35]);
    return {
      borderColor: glowColor.replace(/[\d.]+\)$/, `${glowOpacity})`),
      // Для iOS используем shadowOpacity для glow-эффекта
      ...(Platform.OS === 'ios' ? {
        shadowColor: glowColor,
        shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.05, 0.2]),
        shadowRadius: interpolate(glowPulse.value, [0, 1], [8, 20]),
      } : {}),
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          borderRadius,
          borderColor,
        },
        animatedContainer,
        animatedBorder,
        style,
      ]}
    >
      {/* Внутренний слой с размытием фона */}
      <View
        style={[
          styles.blurLayer,
          {
            borderRadius,
            // CSS-fallback: backgroundColor с opacity имитирует blur на Android
            backgroundColor: COLORS.CARD_BG,
          },
        ]}
      />
      {/* Контент поверх blur-слоя */}
      <View style={styles.content}>
        {children}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  /** Основной контейнер карточки */
  container: {
    overflow: 'hidden',
    borderWidth: 1,
    // iOS glow через shadow
    shadowOffset: { width: 0, height: 0 },
    // Android elevation для тени
    elevation: 4,
  },
  /** Слой размытия / полупрозрачный фон */
  blurLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  /** Контейнер контента с padding */
  content: {
    padding: 16,
  },
});

export default GlassCard;
