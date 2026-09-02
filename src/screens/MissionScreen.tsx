/**
 * Mission: progress, the waypoint list and any validation findings.
 *
 * Progress is by distance, not by waypoint count, because five short legs and
 * one long one are not "83 percent done" after five waypoints.
 */

import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { WaypointRow } from '@components/index';
import { missionLegs, navigationItems, validateMission } from '@core/mission';
import { formatDistance, formatDuration } from '@core/units';
import { useSettings } from '@hooks/settings';
import { useTelemetryContext } from '@hooks/telemetryContext';
import { colors, severityColor, spacing, typography } from '@theme/index';

export function MissionScreen(): React.JSX.Element {
  const { snapshot } = useTelemetryContext();
  const { settings } = useSettings();

  const mission = snapshot?.mission ?? null;
  const progress = snapshot?.progress ?? null;

  const items = useMemo(() => (mission === null ? [] : navigationItems(mission)), [mission]);
  const legs = useMemo(() => (mission === null ? [] : missionLegs(mission)), [mission]);
  const issues = useMemo(() => (mission === null ? [] : validateMission(mission)), [mission]);

  if (mission === null) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          No mission. Missions are read from the vehicle over MAVLink, or supplied by the demo link.
        </Text>
      </View>
    );
  }

  const currentSeq = progress?.nextItem?.seq ?? null;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{mission.name ?? 'Mission'}</Text>
        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${Math.round((progress?.completedFraction ?? 0) * 100)}%` }]}
          />
        </View>
        <View style={styles.summaryRow}>
          <Summary
            label="REMAINING"
            value={formatDistance(progress?.distanceRemainingM ?? null, settings.units).text}
          />
          <Summary label="ETA" value={formatDuration(progress?.etaTotalSeconds ?? null)} />
          <Summary
            label="NEXT"
            value={progress?.nextItem === null || progress === null ? '--' : `#${progress.nextItem.seq}`}
          />
          <Summary
            label="TO NEXT"
            value={formatDistance(progress?.distanceToNextM ?? null, settings.units).text}
          />
        </View>
      </View>

      {issues.length > 0 ? (
        <View style={styles.issues}>
          {issues.slice(0, 4).map((issue) => (
            <Text key={`${issue.code}-${issue.seq}`} style={[styles.issue, { color: severityColor(issue.severity === 'error' ? 'critical' : 'caution') }]}>
              {issue.severity.toUpperCase()}: {issue.message}
            </Text>
          ))}
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.seq)}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <WaypointRow
            item={item}
            state={
              currentSeq === null
                ? 'pending'
                : item.seq === currentSeq
                  ? 'current'
                  : item.seq < currentSeq
                    ? 'done'
                    : 'pending'
            }
            legDistanceM={index === 0 ? null : (legs[index - 1]?.distanceM ?? null)}
            units={settings.units}
          />
        )}
      />
    </View>
  );
}

function Summary({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.summary}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  empty: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  header: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.readoutSmall, color: colors.text },
  progressTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: colors.accent },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  summary: { minWidth: 76 },
  summaryLabel: { ...typography.label, color: colors.textMuted },
  summaryValue: { ...typography.readoutSmall, color: colors.text },
  issues: { paddingHorizontal: spacing.lg, gap: spacing.xs, paddingBottom: spacing.sm },
  issue: { ...typography.body },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
});

export default MissionScreen;
