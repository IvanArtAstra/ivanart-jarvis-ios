/**
 * WaveformView.tsx — Визуализация аудио-волны (waveform)
 * 
 * Особенности:
 *   - Анимированные столбики, реагирующие на уровень звука
 *   - 60fps через Reanimated shared values
 *   - Гладкие переходы между состояниями active/idle
 *   - Настраиваемое количество столбиков и цвет
 * 
 * Использование:
 *   <WaveformView
 *     isActive={isRecording}
 *     color="#00C2FF"
 *     barCount={7}
 *   />
 */

import React, { useEffect } from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';

/** Пропсы компонента WaveformView */
interface WaveformViewProps {
  /** Активна ли волна (запись идёт) */
  isActive: boolean;
  /** Цвет столбиков (по умолчанию CYAN) */
  color?: string;
  /** Количество столбиков (по умолчанию 7) */
  barCount?: number;
  /** Высота контейнера (по умолчанию 48) */
  height?: number;
  /** Ширина одного столбика (по умолчанию 3) */
  barWidth?: number;
  /** Расстояние между столбиками (по умолчанию 4) */
  barGap?: number;
  /** Дополнительные стили */
  style?: ViewStyle;
}

/**
 * Предзаданные амплитуды для каждого столбика
 * Создают визуально приятный "эквалайзер" паттерн
 */
const BAR_AMPLITUDES = [0.4, 0.7, 1.0, 0.85, 1.0, 0.7, 0.4, 0.6, 0.9, 0.5];

/** Компонент одного анимированного столбика */
const WaveBar: React.FC<{
  index: number;
  isActive: boolean;
  color: string;
  height: number;
  barWidth: number;
  totalBars: number;
}> = ({ index, isActive, color, height, barWidth, totalBars }) => {
  // Прогресс анимации столбика (0 → 1 → 0)
  const progress = useSharedValue(0);
  // Общая видимость
  const visibility = useSharedValue(0);

  // Амплитуда из предзаданного массива — циклический доступ
  const amplitude = BAR_AMPLITUDES[index % BAR_AMPLITUDES.length];
  // Задержка для волнового эффекта (от центра)
  const centerOffset = Math.abs(index - totalBars / 2);
  const delayMs = centerOffset * 80;

  useEffect(() => {
    if (isActive) {
      // Плавное появление
      visibility.value = withTiming(1, { duration: 300 });
      // Анимация пульсации с уникальной задержкой и длительностью
      const duration = 600 + (index % 3) * 200; // 600-1000мс
      progress.value = withDelay(
        delayMs,
        withRepeat(
          withSequence(
            withTiming(1, { duration: duration / 2, easing: Easing.inOut(Easing.sine) }),
            withTiming(0, { duration: duration / 2, easing: Easing.inOut(Easing.sine) }),
          ),
          -1,
          true,
        ),
      );
    } else {
      // Плавное скрытие
      progress.value = withTiming(0, { duration: 400 });
      visibility.value = withTiming(0.3, { duration: 400 });
    }
  }, [isActive]);

  const barStyle = useAnimatedStyle(() => {
    // Высота столбика: минимальная (idle) → полная (active) с учётом амплитуды
    const minHeight = height * 0.15;
    const maxHeight = height * amplitude;
    const barHeight = interpolate(progress.value, [0, 1], [minHeight, maxHeight]);

    return {
      height: barHeight,
      opacity: visibility.value,
      backgroundColor: color,
    };
  });

  return (
    <Animated.View
      style={[
        {
          width: barWidth,
          borderRadius: barWidth / 2,
        },
        barStyle,
      ]}
    />
  );
};

export const WaveformView: React.FC<WaveformViewProps> = ({
  isActive,
  color = COLORS.CYAN,
  barCount = 7,
  height = 48,
  barWidth = 3,
  barGap = 4,
  style,
}) => {
  return (
    <View
      style={[
        styles.container,
        { height, gap: barGap },
        style,
      ]}
    >
      {Array.from({ length: barCount }).map((_, index) => (
        <WaveBar
          key={index}
          index={index}
          isActive={isActive}
          color={color}
          height={height}
          barWidth={barWidth}
          totalBars={barCount}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  /** Контейнер — горизонтальный ряд столбиков по центру */
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default WaveformView;
