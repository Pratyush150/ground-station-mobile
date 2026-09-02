/**
 * App root.
 *
 * The screen is kept awake while a link is open. A phone that sleeps mid-flight
 * and has to be woken and unlocked before you can see the battery percentage is
 * not a ground station.
 */

import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RootNavigator from './src/navigation/RootNavigator';
import { SettingsProvider, useSettings } from '@hooks/settings';
import { TelemetryProvider, useTelemetryContext } from '@hooks/telemetryContext';
import { platformAdapters } from './src/platform/adapters';
import { colors } from '@theme/index';

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

function KeepAwakeWhileConnected(): null {
  const { connected } = useTelemetryContext();
  const { settings } = useSettings();

  useEffect(() => {
    if (!connected || !settings.keepAwake) return undefined;
    void activateKeepAwakeAsync('telemetry-link');
    return () => deactivateKeepAwake('telemetry-link');
  }, [connected, settings.keepAwake]);

  return null;
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <TelemetryProvider adapters={platformAdapters}>
          <View style={styles.root}>
            <StatusBar style="light" />
            <KeepAwakeWhileConnected />
            <NavigationContainer theme={navigationTheme}>
              <RootNavigator />
            </NavigationContainer>
          </View>
        </TelemetryProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
