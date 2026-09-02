/**
 * Link health.
 *
 * Shows what the parser measured rather than a signal-strength bar the radio
 * made up: frames decoded, frames the sequence numbers say were lost, CRC
 * failures and the age of the last frame. A rising CRC count with a healthy
 * frame rate means a marginal RF link; a rising loss count with no CRC errors
 * usually means the buffer upstream is dropping whole datagrams.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LinkStats } from '@core/telemetry/types';
import { LinkStatus } from '@core/link';
import { colors, typography } from '@theme/index';

export interface LinkIndicatorProps {
  status: LinkStatus;
  stats: LinkStats;
  /** Milliseconds since the last decoded frame, or null if never. */
  ageMs: number | null;
}

export function LinkIndicator({ status, stats, ageMs }: LinkIndicatorProps): React.JSX.Element {
  const healthy = status.state === 'open' && ageMs !== null && ageMs < 3000;
  const dotColor =
    status.state === 'error' ? colors.critical : healthy ? colors.ok : colors.warning;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.title}>{status.description}</Text>
      </View>
      <View style={styles.grid}>
        <Stat label="FRAMES" value={String(stats.framesDecoded)} />
        <Stat label="LOST" value={String(stats.framesLost)} warn={stats.framesLost > 0} />
        <Stat label="CRC ERR" value={String(stats.crcErrors)} warn={stats.crcErrors > 0} />
        <Stat
          label="LAST"
          value={ageMs === null ? '--' : `${(ageMs / 1000).toFixed(1)} s`}
          warn={ageMs !== null && ageMs > 3000}
        />
        <Stat label="LOSS" value={`${stats.lossRatePct.toFixed(1)} %`} warn={stats.lossRatePct > 5} />
        <Stat label="DROPPED" value={`${stats.bytesDropped} B`} warn={stats.bytesDropped > 0} />
      </View>
      {status.error !== undefined ? <Text style={styles.error}>{status.error}</Text> : null}
    </View>
  );
}

function Stat({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, warn && { color: colors.warning }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderRadius: 8, padding: 12, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { ...typography.body, color: colors.text, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { minWidth: 84 },
  statLabel: { ...typography.label, color: colors.textMuted },
  statValue: { ...typography.mono, color: colors.text },
  error: { ...typography.body, color: colors.critical },
});

export default LinkIndicator;
