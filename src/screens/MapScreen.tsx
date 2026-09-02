/**
 * Map: vehicle, planned path, flown track, home and geofence.
 *
 * The flown track is kept in a ref and appended to rather than rebuilt, and
 * points closer than a few metres apart are dropped. A polyline that grows by
 * five points a second for a twenty-minute flight will otherwise make the map
 * stutter long before the battery runs out.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, Region } from 'react-native-maps';

import { haversineDistanceM } from '@core/geo';
import { navigationItems } from '@core/mission';
import { DEMO_HOME } from '@core/link/demo';
import { colors, spacing, typography } from '@theme/index';
import { useTelemetryContext } from '@hooks/telemetryContext';
import { useSettings } from '@hooks/settings';

/** Minimum spacing between recorded track points, metres. */
const TRACK_POINT_SPACING_M = 3;

export function MapScreen(): React.JSX.Element {
  const { snapshot } = useTelemetryContext();
  const { settings } = useSettings();
  const track = useRef<{ latitude: number; longitude: number }[]>([]);
  const [trackVersion, setTrackVersion] = useState(0);

  const position = snapshot?.vehicle.position ?? null;

  useEffect(() => {
    if (position === null) return;
    const last = track.current[track.current.length - 1];
    const moved =
      last === undefined ||
      haversineDistanceM(
        { latDeg: last.latitude, lonDeg: last.longitude },
        { latDeg: position.latDeg, lonDeg: position.lonDeg },
      ) > TRACK_POINT_SPACING_M;
    if (!moved) return;
    track.current.push({ latitude: position.latDeg, longitude: position.lonDeg });
    setTrackVersion((version) => version + 1);
  }, [position]);

  const planned = useMemo(() => {
    if (snapshot?.mission == null) return [];
    return navigationItems(snapshot.mission).map((item) => ({
      latitude: item.latDeg,
      longitude: item.lonDeg,
    }));
  }, [snapshot?.mission]);

  const initialRegion: Region = {
    latitude: position?.latDeg ?? DEMO_HOME.latDeg,
    longitude: position?.lonDeg ?? DEMO_HOME.lonDeg,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  };

  const fence = settings.geofence;

  return (
    <View style={styles.screen}>
      <MapView style={StyleSheet.absoluteFill} initialRegion={initialRegion} mapType="satellite">
        {planned.length > 1 ? (
          <Polyline coordinates={planned} strokeColor={colors.trackPlanned} strokeWidth={3} />
        ) : null}

        {track.current.length > 1 ? (
          <Polyline
            key={`track-${trackVersion}`}
            coordinates={track.current}
            strokeColor={colors.trackFlown}
            strokeWidth={2}
          />
        ) : null}

        {planned.map((point, index) => (
          <Marker
            key={`wp-${index}`}
            coordinate={point}
            title={`Waypoint ${index}`}
            pinColor={colors.trackPlanned}
          />
        ))}

        {snapshot?.vehicle.home != null ? (
          <Marker
            coordinate={{
              latitude: snapshot.vehicle.home.latDeg,
              longitude: snapshot.vehicle.home.lonDeg,
            }}
            title="Home"
            pinColor={colors.ok}
          />
        ) : null}

        {fence !== null && fence.kind === 'circle' ? (
          <Circle
            center={{ latitude: fence.centre.latDeg, longitude: fence.centre.lonDeg }}
            radius={fence.radiusM}
            strokeColor={colors.geofence}
            strokeWidth={2}
          />
        ) : null}

        {position !== null ? (
          <Marker
            coordinate={{ latitude: position.latDeg, longitude: position.lonDeg }}
            title="Vehicle"
            rotation={position.headingDeg}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
          >
            <View style={styles.vehicleMarker} />
          </Marker>
        ) : null}
      </MapView>

      {snapshot === null ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>No link. Open the Connect tab.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  overlay: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
  },
  overlayText: { ...typography.body, color: colors.textMuted },
  // A triangle: heading is legible at a glance, a dot is not.
  vehicleMarker: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.vehicle,
  },
});

export default MapScreen;
