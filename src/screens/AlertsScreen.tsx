/**
 * Alert feed.
 *
 * Every raise and clear, with the time it happened. After a flight this is the
 * first thing anyone asks about ("did it warn you before it came down?"), so
 * it keeps clears as well as raises rather than only showing what is wrong now.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AlertFeed } from '@components/index';
import { useTelemetryContext } from '@hooks/telemetryContext';
import { colors, spacing, typography } from '@theme/index';

export function AlertsScreen(): React.JSX.Element {
  const { snapshot } = useTelemetryContext();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        <Text style={styles.subtitle}>
          {snapshot === null
            ? 'No link.'
            : `${snapshot.alerts.length} active, ${snapshot.alertEvents.length} events`}
        </Text>
      </View>
      <View style={styles.body}>
        <AlertFeed events={snapshot?.alertEvents ?? []} active={snapshot?.alerts ?? []} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.lg, gap: spacing.xs },
  title: { ...typography.readoutSmall, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  body: { flex: 1, paddingHorizontal: spacing.lg },
});

export default AlertsScreen;
