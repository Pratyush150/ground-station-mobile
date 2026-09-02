import { describe, expect, it } from 'vitest';

import {
  AVIATION_UNITS,
  IMPERIAL_UNITS,
  METRIC_UNITS,
  celsiusToFahrenheit,
  estimateEnduranceSeconds,
  fahrenheitToCelsius,
  feetToMetres,
  formatAltitude,
  formatBatteryPercent,
  formatCapacity,
  formatDistance,
  formatDuration,
  formatHeading,
  formatSpeed,
  formatVerticalSpeed,
  formatVoltage,
  inferCellCount,
  knotsToMs,
  mahToWh,
  metresToFeet,
  metresToNauticalMiles,
  msToKmh,
  msToKnots,
  msToMph,
  precisionFor,
  stateOfChargeFromVoltage,
  whToMah,
} from '../src/core/units';

describe('conversions', () => {
  it('uses the exact international foot and nautical mile', () => {
    expect(metresToFeet(0.3048)).toBeCloseTo(1, 12);
    expect(metresToNauticalMiles(1852)).toBeCloseTo(1, 12);
    expect(msToKmh(1)).toBeCloseTo(3.6, 12);
  });

  it('matches known speed conversions', () => {
    expect(msToKnots(1)).toBeCloseTo(1.9438444924406047, 9);
    expect(msToMph(1)).toBeCloseTo(2.2369362920544025, 9);
  });

  it('round-trips altitude, speed and temperature', () => {
    for (const metres of [0, 1, 47.5, 1000, 12345.678]) {
      expect(feetToMetres(metresToFeet(metres))).toBeCloseTo(metres, 9);
    }
    for (const ms of [0, 0.5, 12, 33.33]) {
      expect(knotsToMs(msToKnots(ms))).toBeCloseTo(ms, 9);
    }
    for (const celsius of [-40, 0, 21.5, 100]) {
      expect(fahrenheitToCelsius(celsiusToFahrenheit(celsius))).toBeCloseTo(celsius, 9);
    }
    expect(celsiusToFahrenheit(-40)).toBe(-40);
  });

  it('round-trips capacity through energy at a fixed voltage', () => {
    expect(whToMah(mahToWh(5200, 22.2), 22.2)).toBeCloseTo(5200, 6);
  });
});

describe('formatters', () => {
  it('picks one decimal below ten and none above', () => {
    expect(precisionFor(4.2)).toBe(1);
    expect(precisionFor(42)).toBe(0);
    expect(formatSpeed(3.456, METRIC_UNITS).text).toBe('3.5 m/s');
    expect(formatSpeed(33.456, METRIC_UNITS).text).toBe('33.5 m/s');
  });

  it('converts altitude into the selected unit', () => {
    expect(formatAltitude(100, METRIC_UNITS).text).toBe('100 m');
    expect(formatAltitude(30.48, IMPERIAL_UNITS).text).toBe('100 ft');
    expect(formatAltitude(12.5, METRIC_UNITS).text).toBe('12.5 m');
  });

  it('uses knots and feet per minute for the aviation preset', () => {
    expect(formatSpeed(10, AVIATION_UNITS).unit).toBe('kt');
    expect(formatVerticalSpeed(2.54, AVIATION_UNITS).text).toBe('500 ft/min');
  });

  it('auto-scales distance from metres to kilometres', () => {
    expect(formatDistance(450, METRIC_UNITS).text).toBe('450 m');
    expect(formatDistance(1450, METRIC_UNITS).text).toBe('1.45 km');
    expect(formatDistance(500, AVIATION_UNITS).unit).toBe('m');
    expect(formatDistance(3704, AVIATION_UNITS).text).toBe('2.00 nm');
  });

  it('renders missing values as a dash rather than a stale number', () => {
    expect(formatAltitude(null, METRIC_UNITS).text).toBe('--');
    expect(formatSpeed(Number.NaN, METRIC_UNITS).text).toBe('--');
    expect(formatBatteryPercent(-1).text).toBe('--');
    expect(formatVoltage(null).text).toBe('--');
  });

  it('formats voltage, capacity, heading and duration the way they are read', () => {
    expect(formatVoltage(22.812).text).toBe('22.81 V');
    expect(formatCapacity(1234).text).toBe('1234 mAh');
    expect(formatCapacity(12340).text).toBe('12.34 Ah');
    expect(formatHeading(7).text).toBe('007°');
    expect(formatHeading(360).text).toBe('000°');
    expect(formatDuration(95)).toBe('1:35');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('--:--');
  });
});

describe('battery interpretation', () => {
  it('infers a plausible cell count from pack voltage', () => {
    expect(inferCellCount(25.2)).toBe(6);
    expect(inferCellCount(16.8)).toBe(4);
    expect(inferCellCount(11.1)).toBe(3);
  });

  it('maps the LiPo curve monotonically', () => {
    expect(stateOfChargeFromVoltage(25.2, 6)).toBe(100);
    expect(stateOfChargeFromVoltage(18.0, 6)).toBe(0);
    const mid = stateOfChargeFromVoltage(22.8, 6);
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(60);
    expect(stateOfChargeFromVoltage(23.4, 6)).toBeGreaterThan(mid);
  });

  it('estimates endurance from draw and reserve, and refuses when it cannot', () => {
    const seconds = estimateEnduranceSeconds({
      packCapacityMah: 5000,
      consumedMah: 1000,
      currentA: 20,
      reserveFraction: 0.2,
    });
    // Usable = 5000 * 0.8 - 1000 = 3000 mAh at 20 A -> 0.15 h -> 540 s.
    expect(seconds).toBeCloseTo(540, 6);
    expect(estimateEnduranceSeconds({ packCapacityMah: 5000, consumedMah: 0, currentA: 0 })).toBeNull();
    expect(
      estimateEnduranceSeconds({ packCapacityMah: 5000, consumedMah: 4900, currentA: 20 }),
    ).toBe(0);
  });
});
