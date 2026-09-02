/**
 * Alert banner and feed.
 *
 * The banner shows only the most severe active alert: stacking six banners
 * over a flight display is how operators learn to ignore them. Everything else
 * lives in the feed on the Alerts screen, with its raise and clear times.
 */

import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ActiveAlert, AlertEvent } from '@core/alerts';
import { colors, severityColor, typography } from '@theme/index';

export function AlertBanner({ alert }: { alert: ActiveAlert | null }): React.JSX.Element | null {
  if (alert === null) return null;
  const color = severityColor(alert.severity);
  return (
    <View style={[styles.banner, { borderLeftColor: color }]}>
      <Text style={[styles.bannerTitle, { color }]}>
        {alert.title}
        {alert.clearing ? ' (clearing)' : ''}
      </Text>
      <Text style={styles.bannerMessage}>{alert.message}</Text>
    </View>
  );
}

export function AlertFeed({
  events,
  active,
}: {
  events: readonly AlertEvent[];
  active: readonly ActiveAlert[];
}): React.JSX.Element {
  // Newest first: the operator wants what just happened, not the flight's
  // opening move.
  const rows = [...events].reverse();
  const activeIds = new Set(active.map((alert) => alert.id));

  return (
    <FlatList
      data={rows}
      keyExtractor={(item, index) => `${item.id}-${item.atMs}-${index}`}
      ListEmptyComponent={<Text style={styles.empty}>No alerts this session.</Text>}
      renderItem={({ item }) => {
        const color = severityColor(item.severity);
        const stillActive = item.kind === 'raised' && activeIds.has(item.id);
        return (
          <View style={styles.row}>
            <View style={[styles.pip, { backgroundColor: item.kind === 'raised' ? color : colors.border }]} />
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: item.kind === 'raised' ? color : colors.textMuted }]}>
                {item.title} {item.kind === 'cleared' ? 'cleared' : ''}
                {stillActive ? ' - active' : ''}
              </Text>
              <Text style={styles.rowMessage}>{item.message}</Text>
              <Text style={styles.rowTime}>T+{(item.atMs / 1000).toFixed(1)} s</Text>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surfaceRaised,
    borderLeftWidth: 4,
    borderRadius: 6,
    padding: 12,
    gap: 2,
  },
  bannerTitle: { ...typography.body, fontWeight: '700' },
  bannerMessage: { ...typography.body, color: colors.text },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10 },
  pip: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.body, fontWeight: '600' },
  rowMessage: { ...typography.body, color: colors.textMuted },
  rowTime: { ...typography.label, color: colors.textDisabled },
  empty: { ...typography.body, color: colors.textMuted, padding: 16 },
});
