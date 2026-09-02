/**
 * Coordinate formatting.
 *
 * Two forms, because operators read both: decimal degrees for pasting into a
 * mission planner, and degrees/minutes/seconds for reading out over a radio.
 */

import { GeoPoint } from '../telemetry/types';

/** Decimal degrees with a fixed number of places. 7 places is ~1 cm. */
export function formatDecimalDegrees(value: number, places = 7): string {
  return value.toFixed(places);
}

/**
 * Degrees / minutes / seconds with a hemisphere letter.
 *
 * Rounding is done on seconds and then carried, so 0.999999 degrees north
 * formats as 1°00'00.0"N rather than 0°59'60.0"N.
 */
export function formatDms(value: number, axis: 'lat' | 'lon', secondsPlaces = 1): string {
  const hemisphere =
    axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const absolute = Math.abs(value);

  let degrees = Math.floor(absolute);
  let minutes = Math.floor((absolute - degrees) * 60);
  let seconds = (absolute - degrees - minutes / 60) * 3600;

  const factor = 10 ** secondsPlaces;
  seconds = Math.round(seconds * factor) / factor;
  if (seconds >= 60) {
    seconds -= 60;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes -= 60;
    degrees += 1;
  }

  const degreeWidth = axis === 'lat' ? 2 : 3;
  return (
    `${String(degrees).padStart(degreeWidth, '0')}°` +
    `${String(minutes).padStart(2, '0')}'` +
    `${seconds.toFixed(secondsPlaces).padStart(secondsPlaces > 0 ? 3 + secondsPlaces : 2, '0')}"` +
    hemisphere
  );
}

/** Both coordinates in decimal degrees, comma separated. */
export function formatPointDecimal(point: GeoPoint, places = 7): string {
  return `${formatDecimalDegrees(point.latDeg, places)}, ${formatDecimalDegrees(point.lonDeg, places)}`;
}

/** Both coordinates in DMS, space separated. */
export function formatPointDms(point: GeoPoint, secondsPlaces = 1): string {
  return `${formatDms(point.latDeg, 'lat', secondsPlaces)} ${formatDms(point.lonDeg, 'lon', secondsPlaces)}`;
}

/** Compass point for a bearing, e.g. 23 -> "NNE". Used on the heading tape. */
export function compassPoint(bearingDeg: number): string {
  const points = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  const index = Math.round((((bearingDeg % 360) + 360) % 360) / 22.5) % 16;
  return points[index];
}
