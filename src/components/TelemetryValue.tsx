/**
 * A labelled telemetry readout that shows its own age.
 *
 * The whole point of this component: a value that has stopped updating must
 * not look like a value that is updating. Stale readouts lose their colour,
 * gain a hatched background and replace the digits with dashes once they are
 * well past their budget, and the age is printed next to them. An operator
 * glancing at the screen can tell the difference in under a second.
 */

import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { FieldFreshness } from '@core/telemetry/staleness';
import { colors, typography } from '@theme/index';

export interface TelemetryValueProps {
  label: string;
  value: string;
  unit?: string;
  freshness?: FieldFreshness;
  emphasis?: 'normal' | 'large';
  /** Overrides the value colour when the value is live. */
  color?: string;
  style?: ViewStyle;
}

export function TelemetryValue({
  label,
  value,
  unit,
  freshness,
  emphasis = 'normal',
  color,
  style,
}: TelemetryValueProps): React.JSX.Element {
  const stale = freshness !== undefined && freshness.status !== 'live';
  const textStyle = emphasis === 'large' ? typography.readoutLarge : typography.readout;

  return (
    <View style={[styles.container, stale && styles.staleContainer, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text
          style={[textStyle, { color: stale ? colors.stale : (color ?? colors.text) }]}
          accessibilityLabel={`${label} ${stale ? 'stale' : value}`}
        >
          {stale ? '--' : value}
        </Text>
        {unit !== undefined ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {stale ? <Text style={styles.staleNote}>{describeAge(freshness)}</Text> : null}
    </View>
  );
}

function describeAge(freshness: FieldFreshness): string {
  if (freshness.status === 'never') return 'no data';
  const seconds = (freshness.ageMs ?? 0) / 1000;
  return `stale ${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)} s`;
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
    minWidth: 104,
  },
  staleContainer: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.stale,
    borderStyle: 'dashed',
  },
  label: { ...typography.label, color: colors.textMuted },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  unit: { ...typography.body, color: colors.textMuted, paddingBottom: 4 },
  staleNote: { ...typography.label, color: colors.stale },
});

export default TelemetryValue;
