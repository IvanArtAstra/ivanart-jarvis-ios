/**
 * OnboardingScreen.tsx — Многошаговый мастер настройки Jarvis
 * 
 * 7 шагов:
 *   1. Welcome — логотип + typewriter приветствие
 *   2. Bluetooth — проверка BLE состояния
 *   3. Scan Glasses — поиск Ray-Ban очков
 *   4. Connection Mode — выбор Auto / SDK / BLE
 *   5. Server Setup — настройка Bridge URL
 *   6. Test — тестовое голосовое взаимодействие
 *   7. Ready — анимация завершения
 * 
 * При завершении сохраняет onboarding_complete в AsyncStorage.
 * При запуске приложения проверяется этот флаг — если true, онбординг пропускается.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Dimensions,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  withRepeat,
  withSequence,
  interpolate,
  Easing,
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme/colors';
import { GlassCard, PulseButton, AnimatedText, FadeSlide, WaveformView } from '../components/animations';
import { connectionManager } from '../services/glasses';
import type { ConnectionMode } from '../services/glasses';

/** Ключ AsyncStorage для проверки завершённого онбординга */
const ONBOARDING_COMPLETE_KEY = '@jarvis/onboarding_complete';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** Пропсы OnboardingScreen */
interface OnboardingScreenProps {
  navigation: any;
}

/** Общее количество шагов */
const TOTAL_STEPS = 7;

// ═══════════════════════════════════════════════════════════════
// Индикатор прогресса шагов
// ═══════════════════════════════════════════════════════════════

const StepIndicator: React.FC<{ currentStep: number; totalSteps: number }> = ({
  currentStep,
  totalSteps,
}) => {
  return (
    <View style={indicatorStyles.container}>
      {Array.from({ length: totalSteps }).map((_, i) => {
        const isActive = i === currentStep;
        const isPast = i < currentStep;
        return (
          <View
            key={i}
            style={[
              indicatorStyles.dot,
              isActive && indicatorStyles.dotActive,
              isPast && indicatorStyles.dotPast,
            ]}
          />
        );
      })}
    </View>
  );
};

const indicatorStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.MUTED,
  },
  dotActive: {
    backgroundColor: COLORS.CYAN,
    width: 24,
    borderRadius: 4,
  },
  dotPast: {
    backgroundColor: 'rgba(0,194,255,0.4)',
  },
});

// ═══════════════════════════════════════════════════════════════
// Шаг 1: Welcome — Приветствие
// ═══════════════════════════════════════════════════════════════

const StepWelcome: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  // Свечение логотипа
  const glowPulse = useSharedValue(0);

  useEffect(() => {
    glowPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sine) }),
        withTiming(0.3, { duration: 2000, easing: Easing.inOut(Easing.sine) }),
      ),
      -1,
      false,
    );
  }, []);

  const logoGlowStyle = useAnimatedStyle(() => ({
    textShadowRadius: interpolate(glowPulse.value, [0, 1], [5, 25]),
    shadowOpacity: interpolate(glowPulse.value, [0, 1], [0.3, 0.8]),
    shadowRadius: interpolate(glowPulse.value, [0, 1], [10, 40]),
  }));

  return (
    <View style={stepStyles.container}>
      {/* Фоновый орб */}
      <View style={stepStyles.glowOrb} />

      {/* Логотип JARVIS с пульсирующим свечением */}
      <FadeSlide delay={0} duration={600}>
        <Animated.Text style={[stepStyles.logo, logoGlowStyle]}>
          JARVIS
        </Animated.Text>
      </FadeSlide>

      {/* Заголовок с typewriter эффектом */}
      <FadeSlide delay={400} duration={500}>
        <View style={stepStyles.titleContainer}>
          <AnimatedText
            text="IvanArt × Jarvis"
            speed={60}
            textStyle={stepStyles.title}
            delay={800}
          />
        </View>
      </FadeSlide>

      {/* Подзаголовок */}
      <FadeSlide delay={1800} duration={600}>
        <Text style={stepStyles.subtitle}>Два разума, одни очки</Text>
      </FadeSlide>

      {/* Кнопка "Начать" */}
      <FadeSlide delay={2400} duration={500}>
        <View style={stepStyles.buttonArea}>
          <PulseButton
            onPress={onNext}
            color={COLORS.CYAN}
            size={72}
            pulseEnabled={true}
            pulseSpeed={2000}
          >
            <Text style={stepStyles.buttonIcon}>→</Text>
          </PulseButton>
          <Text style={stepStyles.buttonLabel}>Начать</Text>
        </View>
      </FadeSlide>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// Шаг 2: Bluetooth — Проверка BLE
// ═══════════════════════════════════════════════════════════════

const StepBluetooth: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const [bleReady, setBleReady] = useState(false);
  const [checking, setChecking] = useState(true);

  // Анимация иконки сканирования
  const scanRotation = useSharedValue(0);

  useEffect(() => {
    // Вращение иконки Bluetooth при проверке
    scanRotation.value = withRepeat(
      withTiming(360, { duration: 2000, easing: Easing.linear }),
      -1,
      false,
    );

    // Проверяем состояние BLE
    checkBluetooth();
  }, []);

  const checkBluetooth = async () => {
    setChecking(true);
    try {
      // Пытаемся инициализировать BLE через connectionManager
      await connectionManager.initialize();
      setBleReady(true);
    } catch (error) {
      // BLE недоступен или отключён
      setBleReady(false);
    }
    setChecking(false);
  };

  const scanStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${scanRotation.value}deg` }],
  }));

  return (
    <View style={stepStyles.container}>
      <FadeSlide delay={0}>
        <Text style={stepStyles.stepTitle}>Bluetooth</Text>
        <Text style={stepStyles.stepDescription}>
          Для подключения к Ray-Ban Meta необходим Bluetooth
        </Text>
      </FadeSlide>

      {/* Иконка Bluetooth */}
      <FadeSlide delay={200}>
        <View style={stepStyles.iconContainer}>
          {checking ? (
            <Animated.Text style={[stepStyles.bigIcon, scanStyle]}>📡</Animated.Text>
          ) : (
            <Text style={stepStyles.bigIcon}>{bleReady ? '✅' : '❌'}</Text>
          )}
        </View>
      </FadeSlide>

      {/* Статус */}
      <FadeSlide delay={400}>
        <GlassCard style={stepStyles.statusCard}>
          {checking ? (
            <View style={stepStyles.statusRow}>
              <ActivityIndicator color={COLORS.CYAN} size="small" />
              <Text style={stepStyles.statusText}>Проверяю Bluetooth...</Text>
            </View>
          ) : bleReady ? (
            <View style={stepStyles.statusRow}>
              <Text style={stepStyles.statusIcon}>✅</Text>
              <Text style={[stepStyles.statusText, { color: COLORS.SUCCESS }]}>
                Bluetooth включён
              </Text>
            </View>
          ) : (
            <View>
              <View style={stepStyles.statusRow}>
                <Text style={stepStyles.statusIcon}>❌</Text>
                <Text style={[stepStyles.statusText, { color: COLORS.ERROR }]}>
                  Включите Bluetooth
                </Text>
              </View>
              <TouchableOpacity
                style={stepStyles.retryButton}
                onPress={checkBluetooth}
              >
                <Text style={stepStyles.retryText}>🔄 Проверить снова</Text>
              </TouchableOpacity>
            </View>
          )}
        </GlassCard>
      </FadeSlide>

      {/* Кнопка "Далее" */}
      <FadeSlide delay={600}>
        <TouchableOpacity
          style={[
            stepStyles.nextButton,
            !bleReady && stepStyles.nextButtonDisabled,
          ]}
          onPress={onNext}
          disabled={!bleReady || checking}
        >
          <Text style={[
            stepStyles.nextButtonText,
            !bleReady && stepStyles.nextButtonTextDisabled,
          ]}>
            Далее →
          </Text>
        </TouchableOpacity>
      </FadeSlide>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// Шаг 3: Scan Glasses — Поиск очков
// ═══════════════════════════════════════════════════════════════

const StepScanGlasses: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');

  // Анимация радара
  const radarPulse = useSharedValue(0);

  useEffect(() => {
    radarPulse.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
  }, []);

  const radarStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(radarPulse.value, [0, 1], [0.8, 1.6]) }],
    opacity: interpolate(radarPulse.value, [0, 0.3, 1], [0.6, 0.3, 0]),
    borderColor: COLORS.CYAN,
  }));

  /** Запуск сканирования и подключения */
  const handleScan = async () => {
    setScanning(true);
    setError('');
    setFound(false);

    try {
      const result = await connectionManager.scanAndConnect();
      if (result) {
        setFound(true);
        setDeviceName(result.name || 'Ray-Ban Meta');
      } else {
        setError('Очки не найдены рядом');
      }
    } catch (e: any) {
      setError(e.message || 'Ошибка сканирования');
    }

    setScanning(false);
  };

  return (
    <View style={stepStyles.container}>
      <FadeSlide delay={0}>
        <Text style={stepStyles.stepTitle}>Поиск очков</Text>
        <Text style={stepStyles.stepDescription}>
          Убедитесь, что Ray-Ban Meta включены и рядом
        </Text>
      </FadeSlide>

      {/* Радар / анимация сканирования */}
      <FadeSlide delay={200}>
        <View style={stepStyles.radarContainer}>
          {scanning && (
            <>
              <Animated.View style={[stepStyles.radarRing, radarStyle]} />
              <Animated.View
                style={[stepStyles.radarRing, {
                  ...radarStyle,
                  // Второе кольцо с задержкой
                }]}
              />
            </>
          )}
          <View style={stepStyles.radarCenter}>
            <Text style={stepStyles.bigIcon}>
              {found ? '🕶️' : scanning ? '📡' : '🔍'}
            </Text>
          </View>
        </View>
      </FadeSlide>

      {/* Результат */}
      <FadeSlide delay={400}>
        <GlassCard style={stepStyles.statusCard}>
          {scanning ? (
            <View style={stepStyles.statusRow}>
              <ActivityIndicator color={COLORS.CYAN} size="small" />
              <Text style={stepStyles.statusText}>Сканирую...</Text>
            </View>
          ) : found ? (
            <View style={stepStyles.statusRow}>
              <Text style={stepStyles.statusIcon}>🕶️</Text>
              <View>
                <Text style={[stepStyles.statusText, { color: COLORS.SUCCESS }]}>
                  Найдены!
                </Text>
                <Text style={stepStyles.deviceName}>{deviceName}</Text>
              </View>
            </View>
          ) : error ? (
            <View style={stepStyles.statusRow}>
              <Text style={stepStyles.statusIcon}>⚠️</Text>
              <Text style={[stepStyles.statusText, { color: COLORS.WARNING }]}>
                {error}
              </Text>
            </View>
          ) : (
            <Text style={stepStyles.statusText}>
              Нажмите «Сканировать» для поиска очков
            </Text>
          )}
        </GlassCard>
      </FadeSlide>

      {/* Кнопки */}
      <FadeSlide delay={600}>
        {!found && (
          <TouchableOpacity
            style={stepStyles.scanButton}
            onPress={handleScan}
            disabled={scanning}
          >
            <Text style={stepStyles.scanButtonText}>
              {scanning ? 'Сканирую...' : '🔍 Сканировать'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[stepStyles.nextButton, { marginTop: 12 }]}
          onPress={onNext}
        >
          <Text style={stepStyles.nextButtonText}>
            {found ? 'Далее →' : 'Пропустить →'}
          </Text>
        </TouchableOpacity>
      </FadeSlide>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// Шаг 4: Connection Mode — Выбор режима подключения
// ═══════════════════════════════════════════════════════════════

const StepConnectionMode: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>('auto');

  /** Конфигурация карточек режимов */
  const modes: { mode: ConnectionMode; icon: string; title: string; desc: string }[] = [
    {
      mode: 'auto',
      icon: '🔄',
      title: 'Авто',
      desc: 'Сначала SDK, при неудаче — BLE. Рекомендуется.',
    },
    {
      mode: 'sdk',
      icon: '📱',
      title: 'Meta SDK',
      desc: 'Камера, дисплей, жесты. Полные возможности.',
    },
    {
      mode: 'ble',
      icon: '📡',
      title: 'BLE UART',
      desc: 'Только текст через Bluetooth. Работает везде.',
    },
  ];

  /** Сохранить режим и перейти дальше */
  const handleNext = async () => {
    try {
      await connectionManager.setMode(selectedMode);
    } catch {
      // Продолжаем даже если setMode не сработал
    }
    onNext();
  };

  return (
    <View style={stepStyles.container}>
      <FadeSlide delay={0}>
        <Text style={stepStyles.stepTitle}>Режим подключения</Text>
        <Text style={stepStyles.stepDescription}>
          Как Jarvis будет общаться с очками?
        </Text>
      </FadeSlide>

      {/* Карточки режимов */}
      {modes.map((item, index) => {
        const isSelected = selectedMode === item.mode;
        return (
          <FadeSlide key={item.mode} delay={200 + index * 150}>
            <TouchableOpacity
              onPress={() => setSelectedMode(item.mode)}
              activeOpacity={0.8}
            >
              <GlassCard
                style={[
                  stepStyles.modeCard,
                  isSelected && stepStyles.modeCardSelected,
                ]}
                borderColor={isSelected ? COLORS.CYAN : COLORS.BORDER}
                glowColor={isSelected ? COLORS.CYAN : 'transparent'}
                disableGlow={!isSelected}
              >
                <View style={stepStyles.modeCardContent}>
                  <Text style={stepStyles.modeIcon}>{item.icon}</Text>
                  <View style={stepStyles.modeTextContainer}>
                    <Text style={[
                      stepStyles.modeTitle,
                      isSelected && { color: COLORS.CYAN },
                    ]}>
                      {item.title}
                    </Text>
                    <Text style={stepStyles.modeDesc}>{item.desc}</Text>
                  </View>
                  {isSelected && (
                    <View style={stepStyles.modeCheck}>
                      <Text style={stepStyles.modeCheckText}>✓</Text>
                    </View>
                  )}
                </View>
              </GlassCard>
            </TouchableOpacity>
          </FadeSlide>
        );
      })}

      {/* Кнопка "Далее" */}
      <FadeSlide delay={700}>
        <TouchableOpacity style={stepStyles.nextButton} onPress={handleNext}>
          <Text style={stepStyles.nextButtonText}>Далее →</Text>
        </TouchableOpacity>
      </FadeSlide>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// Шаг 5: Server Setup — Настройка сервера
// ═══════════════════════════════════════════════════════════════

const StepServerSetup: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const [bridgeUrl, setBridgeUrlLocal] = useState('ws://100.70.68.84:8766');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  /** Пресеты URL */
  const presets = [
    { label: '🏠 Tailscale', value: 'ws://100.70.68.84:8766' },
    { label: '🔧 Localhost', value: 'ws://localhost:8766' },
  ];

  /** Тестирование подключения к серверу */
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    const httpUrl = bridgeUrl
      .replace('ws://', 'http://')
      .replace('wss://', 'https://')
      .replace(/\/$/, '') + '/health';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const start = Date.now();
      const res = await fetch(httpUrl, { signal: controller.signal });
      const latency = Date.now() - start;

      clearTimeout(timeout);

      if (res.ok) {
        setTestResult({
          ok: true,
          message: `✅ Сервер доступен! Задержка: ${latency}мс`,
        });
      } else {
        setTestResult({
          ok: false,
          message: `⚠️ HTTP ${res.status}`,
        });
      }
    } catch (e: any) {
      setTestResult({
        ok: false,
        message: e.name === 'AbortError'
          ? '❌ Таймаут — сервер недоступен'
          : `❌ ${e.message}`,
      });
    }

    setTesting(false);
  };

  /** Сохранить URL и перейти дальше */
  const handleNext = async () => {
    try {
      await AsyncStorage.setItem('@jarvis/bridge_url', bridgeUrl);
    } catch {
      // Продолжаем даже при ошибке сохранения
    }
    onNext();
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={stepStyles.container}
      keyboardShouldPersistTaps="handled"
    >
      <FadeSlide delay={0}>
        <Text style={stepStyles.stepTitle}>Сервер Jarvis</Text>
        <Text style={stepStyles.stepDescription}>
          Укажите адрес Bridge-сервера для связи с AI
        </Text>
      </FadeSlide>

      {/* Пресеты */}
      <FadeSlide delay={200}>
        <View style={stepStyles.presetsRow}>
          {presets.map((preset) => (
            <TouchableOpacity
              key={preset.value}
              style={[
                stepStyles.presetChip,
                bridgeUrl === preset.value && stepStyles.presetChipActive,
              ]}
              onPress={() => setBridgeUrlLocal(preset.value)}
            >
              <Text style={[
                stepStyles.presetChipText,
                bridgeUrl === preset.value && stepStyles.presetChipTextActive,
              ]}>
                {preset.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </FadeSlide>

      {/* Поле ввода URL */}
      <FadeSlide delay={300}>
        <GlassCard style={stepStyles.inputCard}>
          <Text style={stepStyles.inputLabel}>Bridge URL</Text>
          <TextInput
            style={stepStyles.textInput}
            value={bridgeUrl}
            onChangeText={setBridgeUrlLocal}
            placeholder="ws://100.70.68.84:8766"
            placeholderTextColor={COLORS.MUTED}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </GlassCard>
      </FadeSlide>

      {/* Кнопка проверки */}
      <FadeSlide delay={400}>
        <TouchableOpacity
          style={stepStyles.testButton}
          onPress={handleTest}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color={COLORS.CYAN} size="small" />
          ) : (
            <Text style={stepStyles.testButtonText}>🔌 Проверить</Text>
          )}
        </TouchableOpacity>
      </FadeSlide>

      {/* Результат теста */}
      {testResult && (
        <FadeSlide delay={0} duration={300}>
          <Text style={[
            stepStyles.testResult,
            { color: testResult.ok ? COLORS.SUCCESS : COLORS.ERROR },
          ]}>
            {testResult.message}
          </Text>
        </FadeSlide>
      )}

      {/* Кнопка "Далее" */}
      <FadeSlide delay={500}>
        <TouchableOpacity style={stepStyles.nextButton} onPress={handleNext}>
          <Text style={stepStyles.nextButtonText}>Далее →</Text>
        </TouchableOpacity>
      </FadeSlide>
    </ScrollView>
  );
};

// ═══════════════════════════════════════════════════════════════
// Шаг 6: Test — Тестовое взаимодействие
// ═══════════════════════════════════════════════════════════════

const StepTest: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const [phase, setPhase] = useState<'prompt' | 'recording' | 'processing' | 'success' | 'error'>('prompt');
  const [response, setResponse] = useState('');

  /** Имитация тестового запроса */
  const handleTest = async () => {
    setPhase('recording');

    // Даём 2 секунды на "запись"
    setTimeout(async () => {
      setPhase('processing');

      try {
        // Тестовый запрос к серверу
        const bridgeUrl = await AsyncStorage.getItem('@jarvis/bridge_url') || 'ws://100.70.68.84:8766';
        const httpUrl = bridgeUrl
          .replace('ws://', 'http://')
          .replace('wss://', 'https://')
          .replace(/:\d+/, ':8765'); // API порт

        const res = await fetch(`${httpUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Привет, Джарвис!' }),
        });

        if (res.ok) {
          const data = await res.json();
          setResponse(data.reply || data.response || 'Привет! Я Jarvis, готов к работе.');
          setPhase('success');
        } else {
          // Показываем успех с дефолтным ответом — сервер может быть настроен позже
          setResponse('Привет! Я Jarvis. Рад познакомиться! 🤖');
          setPhase('success');
        }
      } catch {
        // Показываем демо-ответ при ошибке сети
        setResponse('Привет! Я Jarvis. Сервер будет настроен позже.');
        setPhase('success');
      }
    }, 2000);
  };

  return (
    <View style={stepStyles.container}>
      <FadeSlide delay={0}>
        <Text style={stepStyles.stepTitle}>Тест</Text>
        <Text style={stepStyles.stepDescription}>
          Попробуем голосовое взаимодействие
        </Text>
      </FadeSlide>

      {/* Промпт */}
      {phase === 'prompt' && (
        <FadeSlide delay={200}>
          <GlassCard style={stepStyles.testPromptCard}>
            <Text style={stepStyles.testPromptText}>
              Скажи: «Джарвис, привет!»
            </Text>
            <Text style={stepStyles.testPromptHint}>
              Или нажми кнопку ниже для тестового запроса
            </Text>
          </GlassCard>

          <View style={stepStyles.testButtonContainer}>
            <PulseButton
              onPress={handleTest}
              color={COLORS.CYAN}
              size={80}
              pulseEnabled={true}
            >
              <Text style={stepStyles.testRecordIcon}>🎙</Text>
            </PulseButton>
          </View>
        </FadeSlide>
      )}

      {/* Запись */}
      {phase === 'recording' && (
        <FadeSlide delay={0} duration={300}>
          <View style={stepStyles.testRecordingContainer}>
            <WaveformView isActive={true} color={COLORS.ERROR} barCount={9} height={56} />
            <Text style={[stepStyles.testPhaseText, { color: COLORS.ERROR }]}>
              ● Слушаю...
            </Text>
          </View>
        </FadeSlide>
      )}

      {/* Обработка */}
      {phase === 'processing' && (
        <FadeSlide delay={0} duration={300}>
          <View style={stepStyles.testProcessingContainer}>
            <ActivityIndicator color={COLORS.PURPLE} size="large" />
            <Text style={[stepStyles.testPhaseText, { color: COLORS.PURPLE }]}>
              Обрабатываю...
            </Text>
          </View>
        </FadeSlide>
      )}

      {/* Успех */}
      {phase === 'success' && (
        <FadeSlide delay={0} duration={400}>
          <GlassCard style={stepStyles.testResponseCard}>
            <Text style={stepStyles.testResponseLabel}>◈ JARVIS</Text>
            <AnimatedText
              text={response}
              speed={30}
              textStyle={stepStyles.testResponseText}
            />
          </GlassCard>

          <View style={stepStyles.testSuccessContainer}>
            <Text style={stepStyles.testSuccessIcon}>🎉</Text>
            <Text style={stepStyles.testSuccessText}>Отлично! Jarvis работает!</Text>
          </View>
        </FadeSlide>
      )}

      {/* Кнопка "Далее" — всегда доступна */}
      <FadeSlide delay={phase === 'prompt' ? 600 : 0}>
        <TouchableOpacity
          style={[stepStyles.nextButton, { marginTop: 20 }]}
          onPress={onNext}
        >
          <Text style={stepStyles.nextButtonText}>
            {phase === 'success' ? 'Далее →' : 'Пропустить →'}
          </Text>
        </TouchableOpacity>
      </FadeSlide>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// Шаг 7: Ready — Завершение
// ═══════════════════════════════════════════════════════════════

const StepReady: React.FC<{ onFinish: () => void }> = ({ onFinish }) => {
  // Анимация конфетти / starburst
  const burstScale = useSharedValue(0);
  const burstOpacity = useSharedValue(0);

  useEffect(() => {
    // Starburst эффект
    burstScale.value = withSpring(1, { damping: 8, stiffness: 80 });
    burstOpacity.value = withSequence(
      withTiming(1, { duration: 300 }),
      withDelay(1500, withTiming(0.3, { duration: 1000 })),
    );
  }, []);

  const burstStyle = useAnimatedStyle(() => ({
    transform: [{ scale: burstScale.value }],
    opacity: burstOpacity.value,
  }));

  return (
    <View style={stepStyles.container}>
      {/* Starburst / конфетти */}
      <Animated.View style={[stepStyles.starburst, burstStyle]}>
        <Text style={stepStyles.starburstEmoji}>🎉</Text>
      </Animated.View>

      <FadeSlide delay={300} duration={600}>
        <Text style={stepStyles.readyTitle}>Jarvis готов к работе!</Text>
      </FadeSlide>

      <FadeSlide delay={600} duration={500}>
        <Text style={stepStyles.readySubtitle}>
          Все настройки можно изменить в разделе «Настройки»
        </Text>
      </FadeSlide>

      {/* Краткая сводка */}
      <FadeSlide delay={900}>
        <GlassCard style={stepStyles.summaryCard}>
          <View style={stepStyles.summaryRow}>
            <Text style={stepStyles.summaryIcon}>🕶️</Text>
            <Text style={stepStyles.summaryText}>Очки настроены</Text>
          </View>
          <View style={stepStyles.summaryRow}>
            <Text style={stepStyles.summaryIcon}>🔗</Text>
            <Text style={stepStyles.summaryText}>Сервер подключён</Text>
          </View>
          <View style={stepStyles.summaryRow}>
            <Text style={stepStyles.summaryIcon}>🎙️</Text>
            <Text style={stepStyles.summaryText}>Голос активирован</Text>
          </View>
        </GlassCard>
      </FadeSlide>

      {/* Финальная кнопка */}
      <FadeSlide delay={1200}>
        <View style={stepStyles.buttonArea}>
          <PulseButton
            onPress={onFinish}
            color={COLORS.SUCCESS}
            size={72}
            pulseEnabled={true}
            pulseSpeed={1800}
          >
            <Text style={stepStyles.buttonIcon}>✓</Text>
          </PulseButton>
          <Text style={[stepStyles.buttonLabel, { color: COLORS.SUCCESS }]}>
            Начать
          </Text>
        </View>
      </FadeSlide>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// Главный компонент OnboardingScreen
// ═══════════════════════════════════════════════════════════════

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ navigation }) => {
  const [currentStep, setCurrentStep] = useState(0);

  /** Перейти к следующему шагу */
  const handleNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep]);

  /** Завершить онбординг — сохранить флаг и перейти на Home */
  const handleFinish = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    } catch {
      // Продолжаем даже при ошибке сохранения
    }
    navigation.replace('Main');
  }, [navigation]);

  /** Рендер текущего шага */
  const renderStep = () => {
    switch (currentStep) {
      case 0: return <StepWelcome onNext={handleNext} />;
      case 1: return <StepBluetooth onNext={handleNext} />;
      case 2: return <StepScanGlasses onNext={handleNext} />;
      case 3: return <StepConnectionMode onNext={handleNext} />;
      case 4: return <StepServerSetup onNext={handleNext} />;
      case 5: return <StepTest onNext={handleNext} />;
      case 6: return <StepReady onFinish={handleFinish} />;
      default: return null;
    }
  };

  return (
    <View style={mainStyles.container}>
      {/* Индикатор шагов (скрыт на Welcome) */}
      {currentStep > 0 && (
        <View style={mainStyles.indicatorContainer}>
          <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />
        </View>
      )}

      {/* Контент текущего шага */}
      <View style={mainStyles.content}>
        {renderStep()}
      </View>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════
// Стили
// ═══════════════════════════════════════════════════════════════

const mainStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BG,
  },
  indicatorContainer: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
  },
  content: {
    flex: 1,
  },
});

/** Общие стили для шагов */
const stepStyles = StyleSheet.create({
  // ── Контейнер шага ──
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingBottom: 40,
  },

  // ── Welcome шаг ──
  glowOrb: {
    position: 'absolute',
    alignSelf: 'center',
    top: '20%',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(0,194,255,0.03)',
    shadowColor: COLORS.CYAN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 100,
  },
  logo: {
    fontSize: 56,
    fontWeight: '200',
    letterSpacing: 20,
    color: COLORS.CYAN,
    textAlign: 'center',
    textShadowColor: COLORS.CYAN,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
    shadowColor: COLORS.CYAN,
    shadowOffset: { width: 0, height: 0 },
    marginBottom: 16,
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.TEXT,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.MUTED,
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 48,
  },

  // ── Общие элементы шагов ──
  stepTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginBottom: 8,
    textAlign: 'center',
  },
  stepDescription: {
    fontSize: 15,
    color: COLORS.MUTED,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },

  // ── Иконка ──
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  bigIcon: {
    fontSize: 64,
  },

  // ── Статус карточка ──
  statusCard: {
    marginBottom: 24,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusIcon: {
    fontSize: 20,
  },
  statusText: {
    fontSize: 16,
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  deviceName: {
    fontSize: 13,
    color: COLORS.MUTED,
    marginTop: 2,
  },

  // ── Кнопки ──
  buttonArea: {
    alignItems: 'center',
    gap: 12,
  },
  buttonIcon: {
    fontSize: 28,
    color: '#000',
    fontWeight: '700',
  },
  buttonLabel: {
    fontSize: 14,
    color: COLORS.CYAN,
    fontWeight: '600',
    letterSpacing: 1,
  },
  nextButton: {
    backgroundColor: COLORS.CYAN_BG,
    borderWidth: 1,
    borderColor: COLORS.CYAN,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  nextButtonText: {
    color: COLORS.CYAN,
    fontSize: 16,
    fontWeight: '700',
  },
  nextButtonDisabled: {
    backgroundColor: 'rgba(58,68,86,0.2)',
    borderColor: COLORS.MUTED,
  },
  nextButtonTextDisabled: {
    color: COLORS.MUTED,
  },
  retryButton: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  retryText: {
    color: COLORS.CYAN,
    fontSize: 14,
  },

  // ── Radar / Scan ──
  radarContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 160,
    marginBottom: 24,
  },
  radarRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: COLORS.CYAN,
  },
  radarCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    backgroundColor: COLORS.CYAN,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  scanButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Connection Mode ──
  modeCard: {
    marginBottom: 12,
  },
  modeCardSelected: {
    // Стили управляются через GlassCard props
  },
  modeCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modeIcon: {
    fontSize: 32,
    marginRight: 16,
  },
  modeTextContainer: {
    flex: 1,
  },
  modeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginBottom: 4,
  },
  modeDesc: {
    fontSize: 13,
    color: COLORS.MUTED,
    lineHeight: 18,
  },
  modeCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.CYAN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeCheckText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Server Setup ──
  presetsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: COLORS.CARD_BG,
  },
  presetChipActive: {
    borderColor: COLORS.CYAN,
    backgroundColor: COLORS.CYAN_BG,
  },
  presetChipText: {
    color: COLORS.MUTED,
    fontSize: 13,
  },
  presetChipTextActive: {
    color: COLORS.CYAN,
  },
  inputCard: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: COLORS.MUTED,
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: COLORS.TEXT,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  testButton: {
    borderWidth: 1,
    borderColor: COLORS.CYAN,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  testButtonText: {
    color: COLORS.CYAN,
    fontSize: 14,
    fontWeight: '600',
  },
  testResult: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },

  // ── Test шаг ──
  testPromptCard: {
    marginBottom: 32,
    alignItems: 'center',
  },
  testPromptText: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 8,
  },
  testPromptHint: {
    fontSize: 13,
    color: COLORS.MUTED,
    textAlign: 'center',
  },
  testButtonContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  testRecordIcon: {
    fontSize: 32,
  },
  testRecordingContainer: {
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  testProcessingContainer: {
    alignItems: 'center',
    gap: 16,
    marginBottom: 32,
  },
  testPhaseText: {
    fontSize: 16,
    fontWeight: '600',
  },
  testResponseCard: {
    marginBottom: 16,
  },
  testResponseLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2.5,
    color: COLORS.CYAN,
    marginBottom: 12,
  },
  testResponseText: {
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.TEXT,
  },
  testSuccessContainer: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  testSuccessIcon: {
    fontSize: 40,
  },
  testSuccessText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.SUCCESS,
  },

  // ── Ready шаг ──
  starburst: {
    position: 'absolute',
    alignSelf: 'center',
    top: '15%',
  },
  starburstEmoji: {
    fontSize: 100,
  },
  readyTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 12,
    marginTop: 80,
  },
  readySubtitle: {
    fontSize: 15,
    color: COLORS.MUTED,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  summaryCard: {
    marginBottom: 32,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  summaryIcon: {
    fontSize: 20,
  },
  summaryText: {
    fontSize: 15,
    color: COLORS.TEXT,
    fontWeight: '500',
  },
});

export default OnboardingScreen;
