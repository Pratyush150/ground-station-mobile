/**
 * One row of the waypoint list.
 *
 * Highlights the item the vehicle is flying towards and dims the ones already
 * behind it, so the list can be read at a glance without counting.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MissionItem, commandLabel } from '@core/mission';
import { UnitPreferences, formatAltitude, formatDistance } from '@core/units';
import { colors, typography } from '@theme/index';

export interface WaypointRowProps {
  item: MissionItem;
  state: 'done' | 'current' | 'pending';
  /** Distance from the previous item, metres. */
  legDistanceM: number | null;
  units: UnitPreferences;
}

export function WaypointRow({ item, state, legDistanceM, units }: WaypointRowProps): React.JSX.Element {
  const accent =
    state === 'current' ? colors.accent : state === 'done' ? colors.textDisabled : colors.textMuted;

  return (
    <View style={[styles.row, state === 'current' && styles.current]}>
      <View style={[styles.seqBubble, { borderColor: accent }]}>
        <Text style={[styles.seq, { color: accent }]}>{item.seq}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.command, state === 'done' && styles.done]}>
          {commandLabel(item.command)}
        </Text>
        <Text style={styles.coords}>
          {item.latDeg.toFixed(6)}, {item.lonDeg.toFixed(6)}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.alt}>{formatAltitude(item.altM, units).text}</Text>
        <Text style={styles.leg}>
          {legDistanceM === null ? '' : formatDistance(legDistanceM, units).text}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    // Large rows: this list is scrolled and tapped with gloves on.
    minHeight: 56,
  },
  current: { backgroundColor: colors.surfaceRaised },
  seqBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seq: { ...typography.mono, fontWeight: '700' },
  body: { flex: 1, gap: 2 },
  command: { ...typography.body, color: colors.text, fontWeight: '600' },
  done: { color: colors.textDisabled },
  coords: { ...typography.mono, color: colors.textMuted },
  right: { alignItems: 'flex-end', gap: 2 },
  alt: { ...typography.mono, color: colors.text },
  leg: { ...typography.label, color: colors.textMuted },
});

export default WaypointRow;
