/**
 * Unit conversion.
 *
 * Telemetry is carried and computed in SI throughout. Conversion happens once,
 * at the display edge, so no part of the logic has to ask which units it is
 * holding. Every factor here is exact by definition (the international foot,
 * the nautical mile), so the round trip is lossless to floating-point.
 */

export const METRES_PER_FOOT = 0.3048;
export const METRES_PER_NAUTICAL_MILE = 1852;
export const METRES_PER_STATUTE_MILE = 1609.344;
export const SECONDS_PER_HOUR = 3600;

export function metresToFeet(m: number): number {
  return m / METRES_PER_FOOT;
}

export function feetToMetres(ft: number): number {
  return ft * METRES_PER_FOOT;
}

export function metresToNauticalMiles(m: number): number {
  return m / METRES_PER_NAUTICAL_MILE;
}

export function nauticalMilesToMetres(nm: number): number {
  return nm * METRES_PER_NAUTICAL_MILE;
}

export function metresToStatuteMiles(m: number): number {
  return m / METRES_PER_STATUTE_MILE;
}

export function statuteMilesToMetres(mi: number): number {
  return mi * METRES_PER_STATUTE_MILE;
}

export function msToKmh(ms: number): number {
  return (ms * SECONDS_PER_HOUR) / 1000;
}

export function kmhToMs(kmh: number): number {
  return (kmh * 1000) / SECONDS_PER_HOUR;
}

export function msToKnots(ms: number): number {
  return (ms * SECONDS_PER_HOUR) / METRES_PER_NAUTICAL_MILE;
}

export function knotsToMs(kt: number): number {
  return (kt * METRES_PER_NAUTICAL_MILE) / SECONDS_PER_HOUR;
}

export function msToMph(ms: number): number {
  return (ms * SECONDS_PER_HOUR) / METRES_PER_STATUTE_MILE;
}

export function mphToMs(mph: number): number {
  return (mph * METRES_PER_STATUTE_MILE) / SECONDS_PER_HOUR;
}

export function metresPerSecondToFeetPerMinute(ms: number): number {
  return metresToFeet(ms) * 60;
}

export function celsiusToFahrenheit(c: number): number {
  return c * 1.8 + 32;
}

export function fahrenheitToCelsius(f: number): number {
  return (f - 32) / 1.8;
}

/** Milliamp-hours to watt-hours at a given pack voltage. */
export function mahToWh(mah: number, voltageV: number): number {
  return (mah / 1000) * voltageV;
}

/** Watt-hours to milliamp-hours at a given pack voltage. */
export function whToMah(wh: number, voltageV: number): number {
  return voltageV === 0 ? 0 : (wh / voltageV) * 1000;
}
