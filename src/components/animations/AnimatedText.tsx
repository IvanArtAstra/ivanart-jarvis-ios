/**
 * AnimatedText.tsx — Эффект печатной машинки (typewriter)
 * 
 * Особенности:
 *   - Текст появляется посимвольно с настраиваемой скоростью
 *   - Мигающий курсор в конце строки
 *   - Можно прервать анимацию тапом — покажет весь текст сразу
 *   - Колбэк onComplete вызывается когда весь текст отображён
 * 
 * Использование:
 *   <AnimatedText 
 *     text="Привет, я Jarvis!"
 *     speed={40}
 *     onComplete={() => console.log('Done')}
 *   />
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Text,
  TouchableOpacity,
  TextStyle,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { COLORS } from '../../theme/colors';

/** Пропсы компонента AnimatedText */
interface AnimatedTextProps {
  /** Текст для отображения с анимацией */
  text: string;
  /** Скорость печати в мс на символ (по умолчанию 35) */
  speed?: number;
  /** Стиль текста */
  textStyle?: TextStyle;
  /** Цвет курсора (по умолчанию CYAN) */
  cursorColor?: string;
  /** Показывать мигающий курсор */
  showCursor?: boolean;
  /** Колбэк при завершении анимации */
  onComplete?: () => void;
  /** Начать анимацию с задержкой (мс) */
  delay?: number;
}

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  speed = 35,
  textStyle,
  cursorColor = COLORS.CYAN,
  showCursor = true,
  onComplete,
  delay = 0,
}) => {
  // Отображаемый фрагмент текста
  const [displayedText, setDisplayedText] = useState('');
  // Анимация завершена — показан весь текст
  const [isComplete, setIsComplete] = useState(false);
  // Ссылка на таймер для очистки
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Текущий индекс символа
  const indexRef = useRef(0);

  // Opacity курсора — мигание
  const cursorOpacity = useSharedValue(1);

  // Мигание курсора: 1 → 0 → 1, бесконечно
  useEffect(() => {
    cursorOpacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 400, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, []);

  // Анимированный стиль курсора
  const cursorStyle = useAnimatedStyle(() => ({
    opacity: cursorOpacity.value,
  }));

  /** Запуск посимвольной анимации */
  useEffect(() => {
    // Сброс при смене текста
    indexRef.current = 0;
    setDisplayedText('');
    setIsComplete(false);

    if (!text) {
      setIsComplete(true);
      return;
    }

    // Задержка перед началом
    const startTimer = setTimeout(() => {
      const typeNextChar = () => {
        if (indexRef.current < text.length) {
          indexRef.current += 1;
          setDisplayedText(text.slice(0, indexRef.current));
          timerRef.current = setTimeout(typeNextChar, speed);
        } else {
          setIsComplete(true);
          onComplete?.();
        }
      };
      typeNextChar();
    }, delay);

    return () => {
      clearTimeout(startTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, speed, delay]);

  /** Прервать анимацию — показать весь текст сразу */
  const handleSkip = useCallback(() => {
    if (!isComplete) {
      if (timerRef.current) clearTimeout(timerRef.current);
      indexRef.current = text.length;
      setDisplayedText(text);
      setIsComplete(true);
      onComplete?.();
    }
  }, [isComplete, text, onComplete]);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={handleSkip}
      disabled={isComplete}
    >
      <Text style={[styles.text, textStyle]}>
        {displayedText}
        {/* Мигающий курсор — показываем пока идёт анимация или если showCursor=true */}
        {showCursor && !isComplete && (
          <Animated.Text style={[styles.cursor, { color: cursorColor }, cursorStyle]}>
            │
          </Animated.Text>
        )}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  /** Основной текст */
  text: {
    color: COLORS.TEXT,
    fontSize: 17,
    lineHeight: 27,
  },
  /** Курсор */
  cursor: {
    fontSize: 17,
    fontWeight: '300',
  },
});

export default AnimatedText;
