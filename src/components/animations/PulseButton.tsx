/**
 * PulseButton.tsx — Анимированная кнопка с эффектом пульсации
 * 
 * Особенности:
 *   - Spring-анимация при нажатии (withSpring для естественного ощущения)
 *   - Расходящееся кольцо пульсации
 *   - Настраиваемый цвет и скорость пульса
 *   - Gesture Handler для отзывчивого тача
 * 
 * Использование:
 *   <PulseButton 
 *     onPress={handleVoice}
 *     color="#00C2FF"
 *     size={92}
 *     pulseEnabled={isRecording}
 *   >
 *     <Text>🎙</Text>
 *   </PulseButton>
 */

import React, { useEffect } from 'react';
import { ViewStyle, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  interpolate,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';

/** Конфигурация spring-анимации для естественного отклика */
const SPRING_CONFIG = {
  damping: 12,
  stiffness: 150,
  mass: 0.8,
};

/** Пропсы компонента PulseButton */
interface PulseButtonProps {
  /** Дочерние элементы (иконка, текст) */
  children: React.ReactNode;
  /** Обработчик нажатия */
  onPress: () => void;
  /** Цвет кнопки и пульсации */
  color?: string;
  /** Размер кнопки (ширина = высота) */
  size?: number;
  /** Включить анимацию пульсации */
  pulseEnabled?: boolean;
  /** Скорость пульсации в мс (один цикл) */
  pulseSpeed?: number;
  /** Количество колец пульсации */
  ringCount?: number;
  /** Кнопка неактивна */
  disabled?: boolean;
  /** Дополнительные стили */
  style?: ViewStyle;
}

/** Компонент одного пульсирующего кольца */
const PulseRing: React.FC<{
  progress: Animated.SharedValue<number>;
  size: number;
  color: string;
  delay: number;
}> = ({ progress, size, color, delay }) => {
  const ringStyle = useAnimatedStyle(() => {
    // Кольцо расширяется от размера кнопки до 1.5x и исчезает
    const scale = interpolate(progress.value, [0, 1], [1, 1.6]);
    const opacity = interpolate(progress.value, [0, 0.3, 1], [0.5, 0.3, 0]);
    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      borderColor: color,
      transform: [{ scale }],
      opacity,
    };
  });

  return <Animated.View style={[styles.ring, ringStyle]} />;
};

export const PulseButton: React.FC<PulseButtonProps> = ({
  children,
  onPress,
  color = COLORS.CYAN,
  size = 92,
  pulseEnabled = false,
  pulseSpeed = 1500,
  ringCount = 2,
  disabled = false,
  style,
}) => {
  // Масштаб кнопки — spring при нажатии
  const buttonScale = useSharedValue(1);
  // Прогресс пульсации колец (0 → 1)
  const pulseProgress = useSharedValue(0);

  // Запуск/остановка пульсации
  useEffect(() => {
    if (pulseEnabled) {
      pulseProgress.value = withRepeat(
        withTiming(1, { duration: pulseSpeed, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      );
    } else {
      pulseProgress.value = withTiming(0, { duration: 300 });
    }
  }, [pulseEnabled, pulseSpeed]);

  /** Обработчик нажатия — уменьшаем кнопку, потом возвращаем пружиной */
  const handlePressIn = () => {
    buttonScale.value = withSpring(0.9, SPRING_CONFIG);
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, SPRING_CONFIG);
  };

  // Анимированный стиль кнопки
  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={disabled ? undefined : handlePressIn}
      onPressOut={disabled ? undefined : handlePressOut}
      style={[styles.wrapper, { width: size * 1.8, height: size * 1.8 }, style]}
    >
      {/* Пульсирующие кольца */}
      {pulseEnabled &&
        Array.from({ length: ringCount }).map((_, i) => (
          <PulseRing
            key={i}
            progress={pulseProgress}
            size={size}
            color={color}
            delay={i * (pulseSpeed / ringCount)}
          />
        ))
      }

      {/* Основная кнопка */}
      <Animated.View
        style={[
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: disabled ? COLORS.MUTED : color,
            shadowColor: color,
            opacity: disabled ? 0.5 : 1,
          },
          animatedButtonStyle,
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  /** Обёртка — центрирует кнопку и кольца */
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Основная кнопка */
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  /** Кольцо пульсации */
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
});

export default PulseButton;
