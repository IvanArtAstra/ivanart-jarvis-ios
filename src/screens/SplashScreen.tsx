/**
 * SplashScreen.tsx — Экран загрузки Jarvis
 * 
 * Показывается при запуске приложения:
 *   1. Тёмный фон (#040810)
 *   2. Анимированный текстовый логотип "JARVIS" с cyan glow
 *   3. Плавное исчезновение через 1.5с
 *   4. Навигация на Onboarding или Home (по флагу в AsyncStorage)
 * 
 * Используется в App.tsx как начальный экран стека навигации
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme/colors';

/** Ключ AsyncStorage для проверки завершённого онбординга */
const ONBOARDING_COMPLETE_KEY = '@jarvis/onboarding_complete';

/** Пропсы SplashScreen */
interface SplashScreenProps {
  navigation: any;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ navigation }) => {
  // Прогресс появления логотипа (0 → 1)
  const logoAppear = useSharedValue(0);
  // Прогресс свечения (0 → 1 → 0.6 пульс)
  const glowIntensity = useSharedValue(0);
  // Прогресс появления подзаголовка
  const subtitleAppear = useSharedValue(0);
  // Fade out всего экрана перед навигацией
  const screenOpacity = useSharedValue(1);

  /** Определяем куда навигировать: Onboarding или Home */
  const navigateNext = async () => {
    try {
      const completed = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
      if (completed === 'true') {
        navigation.replace('Main');
      } else {
        navigation.replace('Onboarding');
      }
    } catch {
      // При ошибке чтения — показываем онбординг
      navigation.replace('Onboarding');
    }
  };

  useEffect(() => {
    // Шаг 1: Появление логотипа (0-500мс)
    logoAppear.value = withTiming(1, {
      duration: 500,
      easing: Easing.out(Easing.cubic),
    });

    // Шаг 2: Свечение нарастает (200-800мс)
    glowIntensity.value = withDelay(
      200,
      withSequence(
        withTiming(1, { duration: 600, easing: Easing.out(Easing.quad) }),
        withTiming(0.7, { duration: 400, easing: Easing.inOut(Easing.sine) }),
      ),
    );

    // Шаг 3: Подзаголовок появляется (600-1000мс)
    subtitleAppear.value = withDelay(
      600,
      withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }),
    );

    // Шаг 4: Fade out и навигация (1500мс)
    screenOpacity.value = withDelay(
      1500,
      withTiming(0, { duration: 300 }, (finished) => {
        if (finished) {
          runOnJS(navigateNext)();
        }
      }),
    );
  }, []);

  // Анимация логотипа — масштаб + opacity
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoAppear.value,
    transform: [
      { scale: interpolate(logoAppear.value, [0, 1], [0.8, 1]) },
    ],
  }));

  // Анимация свечения вокруг текста
  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glowIntensity.value, [0, 1], [0, 0.8]),
    shadowRadius: interpolate(glowIntensity.value, [0, 1], [0, 40]),
    textShadowRadius: interpolate(glowIntensity.value, [0, 1], [0, 20]),
  }));

  // Анимация подзаголовка — fade + slide up
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleAppear.value,
    transform: [
      { translateY: interpolate(subtitleAppear.value, [0, 1], [10, 0]) },
    ],
  }));

  // Fade out всего экрана
  const screenStyle = useAnimatedStyle(() => ({
    opacity: screenOpacity.value,
  }));

  return (
    <Animated.View style={[styles.container, screenStyle]}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.BG} />

      {/* Фоновое свечение */}
      <View style={styles.glowOrb} />

      {/* Логотип JARVIS */}
      <Animated.View style={[styles.logoContainer, logoStyle]}>
        <Animated.Text style={[styles.logoText, glowStyle]}>
          JARVIS
        </Animated.Text>
      </Animated.View>

      {/* Подзаголовок */}
      <Animated.Text style={[styles.subtitle, subtitleStyle]}>
        IvanArt × Intelligence
      </Animated.Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  /** Полноэкранный контейнер */
  container: {
    flex: 1,
    backgroundColor: COLORS.BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Фоновый орб свечения */
  glowOrb: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(0,194,255,0.03)',
    shadowColor: COLORS.CYAN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 100,
  },
  /** Контейнер логотипа */
  logoContainer: {
    alignItems: 'center',
  },
  /** Текст логотипа с glow */
  logoText: {
    fontSize: 52,
    fontWeight: '200',
    letterSpacing: 18,
    color: COLORS.CYAN,
    // iOS text shadow для glow эффекта
    textShadowColor: COLORS.CYAN,
    textShadowOffset: { width: 0, height: 0 },
    // Shadow для внешнего glow
    shadowColor: COLORS.CYAN,
    shadowOffset: { width: 0, height: 0 },
  },
  /** Подзаголовок */
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    letterSpacing: 3,
    color: COLORS.MUTED,
    marginTop: 20,
    textTransform: 'uppercase',
  },
});

export default SplashScreen;
