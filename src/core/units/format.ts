/**
 * Display formatting for telemetry values.
 *
 * The formatter picks precision from magnitude, because a fixed number of
 * decimals is wrong at one end of the range or the other: "0 m/s" hides a
 * drift, "1234.6 m" is six characters of noise on a phone screen in sunlight.
 */

import {
  celsiusToFahrenheit,
  metresPerSecondToFeetPerMinute,
  metresToFeet,
  metresToNauticalMiles,
  metresToStatuteMiles,
  msToKmh,
  msToKnots,
  msToMph,
} from './convert';

export type AltitudeUnit = 'm' | 'ft';
export type SpeedUnit = 'm/s' | 'km/h' | 'mph' | 'kt';
export type DistanceUnit = 'm' | 'km' | 'ft' | 'mi' | 'nm';
export type TemperatureUnit = 'C' | 'F';
export type VerticalSpeedUnit = 'm/s' | 'ft/min';

/** What the operator wants to read. Persisted in Settings. */
export interface UnitPreferences {
  altitude: AltitudeUnit;
  speed: SpeedUnit;
  distance: DistanceUnit;
  temperature: TemperatureUnit;
  verticalSpeed: VerticalSpeedUnit;
}

/** A converted value with its unit and a ready-to-render string. */
export interface FormattedValue {
  value: number;
  unit: string;
  text: string;
}

export const METRIC_UNITS: UnitPreferences = {
  altitude: 'm',
  speed: 'm/s',
  distance: 'm',
  temperature: 'C',
  verticalSpeed: 'm/s',
};

export const IMPERIAL_UNITS: UnitPreferences = {
  altitude: 'ft',
  speed: 'mph',
  distance: 'mi',
  temperature: 'F',
  verticalSpeed: 'ft/min',
};

/** Feet and knots: what most crewed-aviation-trained operators expect. */
export const AVIATION_UNITS: UnitPreferences = {
  altitude: 'ft',
  speed: 'kt',
  distance: 'nm',
  temperature: 'C',
  verticalSpeed: 'ft/min',
};

export const UNIT_PRESETS = {
  metric: METRIC_UNITS,
  imperial: IMPERIAL_UNITS,
  aviation: AVIATION_UNITS,
} as const;

export type UnitPresetName = keyof typeof UNIT_PRESETS;

/**
 * Decimal places for a magnitude.
 *
 * Under 10, one decimal is useful. Between 10 and 1000, whole units are
 * enough. Above that the extra digits are just jitter on a moving display.
 */
export function precisionFor(magnitude: number): number {
  const abs = Math.abs(magnitude);
  if (abs < 10) return 1;
  return 0;
}

function build(value: number, unit: string, places?: number): FormattedValue {
  const decimals = places ?? precisionFor(value);
  return { value, unit, text: `${value.toFixed(decimals)} ${unit}` };
}

/** Placeholder used when a value is missing or too old to display. */
export const NO_DATA: FormattedValue = { value: Number.NaN, unit: '', text: '--' };

export function formatAltitude(metres: number | null, prefs: UnitPreferences): FormattedValue {
  if (metres === null || !Number.isFinite(metres)) return NO_DATA;
  const value = prefs.altitude === 'ft' ? metresToFeet(metres) : metres;
  return build(value, prefs.altitude, Math.abs(value) < 100 ? 1 : 0);
}

export function formatSpeed(ms: number | null, prefs: UnitPreferences): FormattedValue {
  if (ms === null || !Number.isFinite(ms)) return NO_DATA;
  switch (prefs.speed) {
    case 'km/h':
      return build(msToKmh(ms), 'km/h');
    case 'mph':
      return build(msToMph(ms), 'mph');
    case 'kt':
      return build(msToKnots(ms), 'kt');
    default:
      return build(ms, 'm/s', 1);
  }
}

export function formatVerticalSpeed(ms: number | null, prefs: UnitPreferences): FormattedValue {
  if (ms === null || !Number.isFinite(ms)) return NO_DATA;
  if (prefs.verticalSpeed === 'ft/min') {
    const value = metresPerSecondToFeetPerMinute(ms);
    return build(value, 'ft/min', 0);
  }
  return build(ms, 'm/s', 1);
}

/**
 * Distance, auto-scaled.
 *
 * Metres up to a kilometre, then kilometres: "1450 m" is harder to read at a
 * glance than "1.45 km" when you are checking whether the aircraft is still
 * within visual line of sight.
 */
export function formatDistance(metres: number | null, prefs: UnitPreferences): FormattedValue {
  if (metres === null || !Number.isFinite(metres)) return NO_DATA;
  switch (prefs.distance) {
    case 'km':
      return build(metres / 1000, 'km', 2);
    case 'ft':
      return build(metresToFeet(metres), 'ft', 0);
    case 'mi': {
      const feet = metresToFeet(metres);
      if (feet < 1000) return build(feet, 'ft', 0);
      return build(metresToStatuteMiles(metres), 'mi', 2);
    }
    case 'nm': {
      if (metres < 1000) return build(metres, 'm', 0);
      return build(metresToNauticalMiles(metres), 'nm', 2);
    }
    default:
      if (metres >= 1000) return build(metres / 1000, 'km', 2);
      return build(metres, 'm', metres < 10 ? 1 : 0);
  }
}

export function formatTemperature(
  celsius: number | null,
  prefs: UnitPreferences,
): FormattedValue {
  if (celsius === null || !Number.isFinite(celsius)) return NO_DATA;
  const value = prefs.temperature === 'F' ? celsiusToFahrenheit(celsius) : celsius;
  return { value, unit: `°${prefs.temperature}`, text: `${value.toFixed(0)} °${prefs.temperature}` };
}

/** Pack voltage. Always two decimals: 0.1 V of sag is worth seeing. */
export function formatVoltage(volts: number | null): FormattedValue {
  if (volts === null || !Number.isFinite(volts)) return NO_DATA;
  return { value: volts, unit: 'V', text: `${volts.toFixed(2)} V` };
}

export function formatCurrent(amps: number | null): FormattedValue {
  if (amps === null || !Number.isFinite(amps)) return NO_DATA;
  return { value: amps, unit: 'A', text: `${amps.toFixed(1)} A` };
}

/** Battery percentage. -1 from the autopilot means "no estimate available". */
export function formatBatteryPercent(percent: number | null): FormattedValue {
  if (percent === null || !Number.isFinite(percent) || percent < 0) return NO_DATA;
  return { value: percent, unit: '%', text: `${Math.round(percent)} %` };
}

/** Consumed capacity, switching to amp-hours once the number gets long. */
export function formatCapacity(mah: number | null): FormattedValue {
  if (mah === null || !Number.isFinite(mah)) return NO_DATA;
  if (mah >= 10000) return { value: mah / 1000, unit: 'Ah', text: `${(mah / 1000).toFixed(2)} Ah` };
  return { value: mah, unit: 'mAh', text: `${Math.round(mah)} mAh` };
}

/** Heading, always three digits, the way it is read on a radio. */
export function formatHeading(deg: number | null): FormattedValue {
  if (deg === null || !Number.isFinite(deg)) return NO_DATA;
  const wrapped = Math.round(((deg % 360) + 360) % 360) % 360;
  return { value: wrapped, unit: '°', text: `${String(wrapped).padStart(3, '0')}°` };
}

/** Duration as m:ss, or h:mm:ss past an hour. Used for ETA and flight time. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
