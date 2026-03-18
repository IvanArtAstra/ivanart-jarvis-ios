/**
 * App.tsx — IvanArt × Jarvis — Главный навигационный контроллер
 * 
 * Поток навигации:
 *   SplashScreen → (проверка AsyncStorage) → OnboardingScreen | MainTabs
 * 
 * Структура:
 *   Stack Navigator (без заголовков):
 *     - Splash — экран загрузки с анимированным логотипом
 *     - Onboarding — многошаговый мастер настройки
 *     - Main — основные вкладки (Home / Chat)
 */

import React from 'react';
import { StatusBar, Text, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SplashScreen } from './src/screens/SplashScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import ChatScreen from './src/screens/ChatScreen';
import { COLORS } from './src/theme/colors';

// ── Типы навигации ──
type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Main: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

/** Иконка вкладки — эмодзи с изменением opacity при фокусе */
const TabIcon = ({ emoji, focused }: { emoji: string; focused: boolean }) => (
  <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
);

/** Основные вкладки приложения */
const MainTabs = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0D0D15',
          borderTopColor: COLORS.BORDER,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 85 : 65,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: COLORS.CYAN,
        tabBarInactiveTintColor: COLORS.MUTED,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Главная',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🎙️" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          tabBarLabel: 'Чат',
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
};

/** Корневой компонент приложения */
const App = () => {
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.BG} />
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          // Анимация перехода — fade
          cardStyleInterpolator: ({ current }) => ({
            cardStyle: {
              opacity: current.progress,
            },
          }),
          // Отключаем жест "назад" на splash/onboarding
          gestureEnabled: false,
        }}
        initialRouteName="Splash"
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
