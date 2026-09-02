/**
 * Battery state: percentage, pack voltage and per-cell voltage.
 *
 * Per-cell voltage is shown because it is the number that tells you whether a
 * pack is genuinely low or the coulomb counter started from a bad assumption.
 * When the autopilot reports -1 (no estimate) the bar is replaced by the
 * voltage-derived figure, clearly labelled as an estimate rather than blended
 * into the reported value.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { cellVoltage, formatVoltage, stateOfChargeFromVoltage } from '@core/units';
import { batteryColor, colors, typography } from '@theme/index';

export interface BatteryIndicatorProps {
  voltageV: number | null;
  currentA: number | null;
  remainingPct: number | null;
  cellCount?: number;
  stale: boolean;
}

export function BatteryIndicator({
  voltageV,
  currentA,
  remainingPct,
  cellCount,
  stale,
}: BatteryIndicatorProps): React.JSX.Element {
  const reported = remainingPct !== null && remainingPct >= 0 ? remainingPct : null;
  const estimated =
    voltageV === null ? null : Math.round(stateOfChargeFromVoltage(voltageV, cellCount));
  const percent = reported ?? estimated;
  const barColor = stale ? colors.stale : batteryColor(percent);
  const perCell = voltageV === null ? null : cellVoltage(voltageV, cellCount);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>BATTERY</Text>
        <Text style={styles.source}>{reported === null ? 'from voltage' : 'reported'}</Text>
      </View>

      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${Math.max(0, Math.min(100, percent ?? 0))}%`, backgroundColor: barColor },
          ]}
        />
      </View>

      <View style={styles.row}>
        <Text style={[styles.percent, { color: barColor }]}>
          {stale || percent === null ? '--' : `${Math.round(percent)} %`}
        </Text>
        <View style={styles.detail}>
          <Text style={styles.detailText}>{stale ? '--' : formatVoltage(voltageV).text}</Text>
          <Text style={styles.detailMuted}>
            {stale || perCell === null ? '--' : `${perCell.toFixed(2)} V/cell`}
          </Text>
          <Text style={styles.detailMuted}>
            {stale || currentA === null ? '--' : `${currentA.toFixed(1)} A`}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderRadius: 8, padding: 12, gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...typography.label, color: colors.textMuted },
  source: { ...typography.label, color: colors.textDisabled },
  barTrack: { height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  percent: { ...typography.readout },
  detail: { alignItems: 'flex-end' },
  detailText: { ...typography.mono, color: colors.text },
  detailMuted: { ...typography.mono, color: colors.textMuted },
});

export default BatteryIndicator;
