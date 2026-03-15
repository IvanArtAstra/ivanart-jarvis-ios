/**
 * IvanArt × Jarvis — точка входа
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { HomeScreen } from './src/screens/HomeScreen';

const App = () => {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0F" />
      <HomeScreen />
    </>
  );
};

export default App;
