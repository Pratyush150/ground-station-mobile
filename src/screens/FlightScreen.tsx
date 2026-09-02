/**
 * Primary flight display plus the numbers that decide whether to keep flying.
 *
 * Layout is fixed rather than scrollable above the fold: in the field you look
 * down for a second and look up again, and a screen that has scrolled since
 * you last saw it costs you that second.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AlertBanner, BatteryIndicator, PrimaryFlightDisplay, TelemetryValue } from '@components/index';
import { relativeToHome } from '@core/geo';
import {
  formatDistance,
  formatDuration,
  formatHeading,
  formatSpeed,
  metresToFeet,
} from '@core/units';
import { useSettings } from '@hooks/settings';
import { useTelemetryContext } from '@hooks/telemetryContext';
import { colors, spacing, typography } from '@theme/index';

export function FlightScreen(): React.JSX.Element {
  const { snapshot } = useTelemetryContext();
  const { settings } = useSettings();
  const { width } = useWindowDimensions();

  if (snapshot === null) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No link. Open the Connect tab.</Text>
      </View>
    );
  }

  const { vehicle, freshness, progress } = snapshot;
  const attitudeStale = freshness.attitude?.status !== 'live';
  const positionStale = freshness.position?.status !== 'live';
  const altitudeM = vehicle.position?.altRelM ?? null;
  const groundspeed = vehicle.airData?.groundspeedMs ?? null;
  const home = vehicle.home;
  const position = vehicle.position;
  const homeRelative =
    home !== null && position !== null
      ? relativeToHome(home, { latDeg: position.latDeg, lonDeg: position.lonDeg, altM: position.altRelM })
      : null;

  const pfdAltitude =
    altitudeM === null ? null : settings.units.altitude === 'ft' ? metresToFeet(altitudeM) : altitudeM;
  const pfdSpeed = groundspeed === null ? null : formatSpeed(groundspeed, settings.units).value;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <AlertBanner alert={snapshot.alerts[0] ?? null} />

      <View style={styles.statusRow}>
        <Text style={styles.mode}>{vehicle.mode?.name ?? 'NO MODE'}</Text>
        <Text style={[styles.armed, vehicle.armedState?.armed === true && styles.armedActive]}>
          {vehicle.armedState?.armed === true ? 'ARMED' : 'DISARMED'}
        </Text>
        <Text style={styles.stack}>{vehicle.stack.toUpperCase()}</Text>
      </View>

      <PrimaryFlightDisplay
        rollRad={vehicle.attitude?.rollRad ?? 0}
        pitchRad={vehicle.attitude?.pitchRad ?? 0}
        headingDeg={vehicle.position?.headingDeg ?? vehicle.airData?.headingDeg ?? 0}
        altitude={pfdAltitude}
        altitudeUnit={settings.units.altitude}
        speed={pfdSpeed}
        speedUnit={settings.units.speed}
        verticalSpeed={vehicle.airData?.climbRateMs ?? null}
        attitudeStale={attitudeStale}
        dataStale={positionStale}
        width={width - spacing.lg * 2}
        height={280}
      />

      <View style={styles.grid}>
        <TelemetryValue
          label="HEADING"
          value={formatHeading(vehicle.position?.headingDeg ?? null).text}
          freshness={freshness.position}
        />
        <TelemetryValue
          label="GROUNDSPEED"
          value={formatSpeed(groundspeed, settings.units).text}
          freshness={freshness.airData}
        />
        <TelemetryValue
          label="HOME DIST"
          value={formatDistance(homeRelative?.distanceM ?? null, settings.units).text}
          freshness={freshness.position}
        />
        <TelemetryValue
          label="HOME BRG"
          value={formatHeading(homeRelative?.reciprocalBearingDeg ?? null).text}
          freshness={freshness.position}
        />
        <TelemetryValue
          label="SATS"
          value={vehicle.gps === null ? '--' : String(vehicle.gps.satellitesVisible)}
          freshness={freshness.gps}
        />
        <TelemetryValue
          label="MISSION ETA"
          value={formatDuration(progress?.etaTotalSeconds ?? null)}
          freshness={freshness.missionCurrent}
        />
      </View>

      <BatteryIndicator
        voltageV={vehicle.battery?.voltageV ?? null}
        currentA={vehicle.battery?.currentA ?? null}
        remainingPct={vehicle.battery?.remainingPct ?? null}
        cellCount={vehicle.battery?.cellCount}
        stale={freshness.battery?.status !== 'live'}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  empty: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.body, color: colors.textMuted },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mode: { ...typography.readoutSmall, color: colors.accent, flex: 1 },
  armed: { ...typography.label, color: colors.textMuted },
  armedActive: { color: colors.critical },
  stack: { ...typography.label, color: colors.textDisabled },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

export default FlightScreen;
