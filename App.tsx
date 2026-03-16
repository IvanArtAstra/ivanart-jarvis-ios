/**
 * IvanArt × Jarvis — App Entry Point
 * Tab navigation: Home + Chat
 */

import React from 'react';
import { StatusBar, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from './src/screens/HomeScreen';
import { ChatScreen } from './src/screens/ChatScreen';

const Tab = createBottomTabNavigator();

const App = () => {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#040810" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: '#040810',
              borderTopColor: 'rgba(0,194,255,0.12)',
              borderTopWidth: 1,
              paddingBottom: 4,
              height: 56,
            },
            tabBarActiveTintColor:   '#00C2FF',
            tabBarInactiveTintColor: '#3A4456',
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
              letterSpacing: 0.5,
            },
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{
              tabBarLabel: 'Главная',
              tabBarIcon: ({ color }) => (
                <Text style={{ fontSize: 20, color }}>🎙</Text>
              ),
            }}
          />
          <Tab.Screen
            name="Chat"
            component={ChatScreen}
            options={{
              tabBarLabel: 'Чат',
              tabBarIcon: ({ color }) => (
                <Text style={{ fontSize: 20, color }}>◈</Text>
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
};

export default App;
