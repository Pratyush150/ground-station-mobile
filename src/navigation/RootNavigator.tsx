/**
 * Bottom tabs.
 *
 * Tabs rather than a drawer: a drawer needs an edge swipe, and edge swipes on
 * a phone held in one hand while the other is on a transmitter are how you end
 * up on the wrong screen at the wrong moment. Six fixed targets, always in the
 * same place.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import {
  AlertsScreen,
  ConnectScreen,
  FlightScreen,
  MapScreen,
  MissionScreen,
  SettingsScreen,
} from '@screens/index';
import { colors } from '@theme/index';
import { useTelemetryContext } from '@hooks/telemetryContext';

const Tab = createBottomTabNavigator();

export function RootNavigator(): React.JSX.Element {
  const { snapshot } = useTelemetryContext();
  const activeAlerts = snapshot?.alerts.length ?? 0;

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 12, paddingBottom: 6 },
      }}
    >
      <Tab.Screen name="Flight" component={FlightScreen} />
      <Tab.Screen name="Map" component={MapScreen} />
      <Tab.Screen name="Mission" component={MissionScreen} />
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{ tabBarBadge: activeAlerts > 0 ? activeAlerts : undefined }}
      />
      <Tab.Screen name="Connect" component={ConnectScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default RootNavigator;
