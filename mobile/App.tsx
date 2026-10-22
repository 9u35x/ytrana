import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth';
import { AppNavigator } from './src/navigation';

export default function App() {
  return <SafeAreaProvider><AuthProvider><StatusBar style="dark" /><AppNavigator /></AuthProvider></SafeAreaProvider>;
}
