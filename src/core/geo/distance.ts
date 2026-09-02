/**
 * Great-circle geometry over WGS-84 coordinates.
 *
 * Everything here uses the spherical earth approximation with the WGS-84 mean
 * radius. Over the few kilometres a small UAV flies, the error against the
 * full ellipsoidal (Vincenty) solution is well under a metre, which is far
 * inside GPS noise. Vincenty is not worth the iteration cost on a phone that
 * is redrawing a map at 10 Hz.
 */

import { GeoPoint } from '../telemetry/types';

/** WGS-84 mean radius, metres (IUGG R1). */
export const EARTH_RADIUS_M = 6371008.8;

const DEG = Math.PI / 180;

export function toRadians(deg: number): number {
  return deg * DEG;
}

export function toDegrees(rad: number): number {
  return rad / DEG;
}

/** Wrap an angle into 0..360. */
export function normaliseDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed smallest difference between two headings, -180..180. */
export function headingDeltaDeg(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

/**
 * Haversine distance in metres.
 *
 * Haversine rather than the spherical law of cosines because it stays
 * numerically stable for the short legs a drone actually flies; the law of
 * cosines loses precision below a few tens of metres in float arithmetic.
 */
export function haversineDistanceM(from: GeoPoint, to: GeoPoint): number {
  const lat1 = toRadians(from.latDeg);
  const lat2 = toRadians(to.latDeg);
  const dLat = lat2 - lat1;
  const dLon = toRadians(to.lonDeg - from.lonDeg);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Straight-line distance including the altitude difference.
 *
 * This is the number that matters for "how far away is it", because a vehicle
 * 200 m up and 50 m out is not 50 m away.
 */
export function slantDistanceM(from: GeoPoint, to: GeoPoint): number {
  const ground = haversineDistanceM(from, to);
  const dAlt = (to.altM ?? 0) - (from.altM ?? 0);
  return Math.sqrt(ground * ground + dAlt * dAlt);
}

/** Initial great-circle bearing from `from` to `to`, degrees 0..360. */
export function initialBearingDeg(from: GeoPoint, to: GeoPoint): number {
  const lat1 = toRadians(from.latDeg);
  const lat2 = toRadians(to.latDeg);
  const dLon = toRadians(to.lonDeg - from.lonDeg);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normaliseDeg(toDegrees(Math.atan2(y, x)));
}

/**
 * Project a point a given distance and bearing away.
 *
 * Used by the demo flight generator and by the map screen when it draws the
 * range rings around the home point.
 */
export function destinationPoint(from: GeoPoint, bearingDeg: number, distanceM: number): GeoPoint {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(from.latDeg);
  const lon1 = toRadians(from.lonDeg);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latDeg: toDegrees(lat2),
    lonDeg: ((toDegrees(lon2) + 540) % 360) - 180,
    altM: from.altM,
  };
}

/** Ground distance and bearing from the home point to the vehicle. */
export interface HomeRelative {
  distanceM: number;
  slantDistanceM: number;
  bearingDeg: number;
  /** Bearing from the vehicle back to home, i.e. where RTL will fly. */
  reciprocalBearingDeg: number;
}

/** Compute the vehicle's position relative to home. */
export function relativeToHome(home: GeoPoint, vehicle: GeoPoint): HomeRelative {
  const bearing = initialBearingDeg(home, vehicle);
  return {
    distanceM: haversineDistanceM(home, vehicle),
    slantDistanceM: slantDistanceM(home, vehicle),
    bearingDeg: bearing,
    reciprocalBearingDeg: initialBearingDeg(vehicle, home),
  };
}

/**
 * Perpendicular distance from a point to the great-circle track a->b.
 *
 * Positive means right of track, negative means left, which is the sign
 * convention a pilot expects on a cross-track indicator.
 */
export function crossTrackDistanceM(from: GeoPoint, to: GeoPoint, point: GeoPoint): number {
  const d13 = haversineDistanceM(from, point) / EARTH_RADIUS_M;
  const theta13 = toRadians(initialBearingDeg(from, point));
  const theta12 = toRadians(initialBearingDeg(from, to));
  return Math.asin(Math.sin(d13) * Math.sin(theta13 - theta12)) * EARTH_RADIUS_M;
}
