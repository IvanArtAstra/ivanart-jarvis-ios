/**
 * FadeSlide.tsx — Обёртка для анимации появления элементов
 * 
 * Особенности:
 *   - Fade in + slide (вверх/вниз/влево/вправо) при mount
 *   - Настраиваемая задержка для stagger-эффекта в списках
 *   - Лёгкий и переиспользуемый
 * 
 * Использование:
 *   {items.map((item, i) => (
 *     <FadeSlide key={item.id} delay={i * 100} direction="up">
 *       <ItemCard data={item} />
 *     </FadeSlide>
 *   ))}
 */

import React, { useEffect } from 'react';
import { ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from 'react-native-reanimated';

/** Направления анимации slide */
type SlideDirection = 'up' | 'down' | 'left' | 'right';

/** Пропсы компонента FadeSlide */
interface FadeSlideProps {
  /** Дочерние элементы для анимации */
  children: React.ReactNode;
  /** Задержка перед началом анимации (мс, по умолчанию 0) */
  delay?: number;
  /** Длительность анимации (мс, по умолчанию 500) */
  duration?: number;
  /** Направление slide (по умолчанию 'up') */
  direction?: SlideDirection;
  /** Расстояние slide в пикселях (по умолчанию 20) */
  distance?: number;
  /** Дополнительные стили */
  style?: ViewStyle;
}

/**
 * Маппинг направлений в transform-свойства
 * up/down → translateY, left/right → translateX
 */
const getTransformConfig = (direction: SlideDirection, distance: number) => {
  switch (direction) {
    case 'up':    return { key: 'translateY' as const, from: distance };
    case 'down':  return { key: 'translateY' as const, from: -distance };
    case 'left':  return { key: 'translateX' as const, from: distance };
    case 'right': return { key: 'translateX' as const, from: -distance };
  }
};

export const FadeSlide: React.FC<FadeSlideProps> = ({
  children,
  delay = 0,
  duration = 500,
  direction = 'up',
  distance = 20,
  style,
}) => {
  // Прогресс анимации 0 → 1
  const progress = useSharedValue(0);

  const { key, from } = getTransformConfig(direction, distance);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const translateValue = interpolate(progress.value, [0, 1], [from, 0]);
    return {
      opacity: progress.value,
      transform: [{ [key]: translateValue }],
    };
  });

  return (
    <Animated.View style={[animatedStyle, style]}>
      {children}
    </Animated.View>
  );
};

export default FadeSlide;
