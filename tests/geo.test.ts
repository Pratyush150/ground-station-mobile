import { describe, expect, it } from 'vitest';

import {
  EARTH_RADIUS_M,
  checkGeofence,
  compassPoint,
  crossTrackDistanceM,
  destinationPoint,
  formatDms,
  formatPointDecimal,
  haversineDistanceM,
  headingDeltaDeg,
  initialBearingDeg,
  pointInPolygon,
  relativeToHome,
  slantDistanceM,
} from '../src/core/geo';

const ORIGIN = { latDeg: 0, lonDeg: 0 };

describe('haversine distance', () => {
  it('matches the hand-computed one-degree arc at the equator', () => {
    // One degree of arc is R * pi / 180 = 111194.93 m for R = 6371008.8 m.
    const expected = (EARTH_RADIUS_M * Math.PI) / 180;
    expect(haversineDistanceM(ORIGIN, { latDeg: 0, lonDeg: 1 })).toBeCloseTo(expected, 3);
    expect(haversineDistanceM(ORIGIN, { latDeg: 1, lonDeg: 0 })).toBeCloseTo(expected, 3);
  });

  it('is zero for identical points and symmetric otherwise', () => {
    expect(haversineDistanceM(ORIGIN, ORIGIN)).toBe(0);
    const a = { latDeg: 47.397742, lonDeg: 8.545594 };
    const b = { latDeg: 47.4, lonDeg: 8.55 };
    expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 9);
  });

  it('gives half the circumference for antipodal points on the equator', () => {
    expect(haversineDistanceM(ORIGIN, { latDeg: 0, lonDeg: 180 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_M,
      3,
    );
  });

  it('includes altitude in the slant distance', () => {
    const from = { latDeg: 0, lonDeg: 0, altM: 0 };
    const to = destinationPoint(from, 90, 40);
    expect(slantDistanceM(from, { ...to, altM: 30 })).toBeCloseTo(50, 2);
  });
});

describe('bearings', () => {
  it('matches the cardinal directions', () => {
    expect(initialBearingDeg(ORIGIN, { latDeg: 1, lonDeg: 0 })).toBeCloseTo(0, 6);
    expect(initialBearingDeg(ORIGIN, { latDeg: 0, lonDeg: 1 })).toBeCloseTo(90, 6);
    expect(initialBearingDeg(ORIGIN, { latDeg: -1, lonDeg: 0 })).toBeCloseTo(180, 6);
    expect(initialBearingDeg(ORIGIN, { latDeg: 0, lonDeg: -1 })).toBeCloseTo(270, 6);
  });

  it('matches the hand-computed great-circle bearing to (1, 1)', () => {
    // atan2(sin(dLon) * cos(lat2), sin(lat2)) with lat1 = 0
    // = atan2(sin 1 deg * cos 1 deg, sin 1 deg) = 44.99565 deg.
    expect(initialBearingDeg(ORIGIN, { latDeg: 1, lonDeg: 1 })).toBeCloseTo(44.99565, 4);
  });

  it('round-trips through destinationPoint', () => {
    const home = { latDeg: 47.397742, lonDeg: 8.545594 };
    const target = destinationPoint(home, 123.4, 850);
    expect(haversineDistanceM(home, target)).toBeCloseTo(850, 6);
    expect(initialBearingDeg(home, target)).toBeCloseTo(123.4, 4);
  });

  it('wraps heading differences to the shortest way round', () => {
    expect(headingDeltaDeg(350, 10)).toBeCloseTo(20, 9);
    expect(headingDeltaDeg(10, 350)).toBeCloseTo(-20, 9);
  });

  it('computes the reciprocal bearing home', () => {
    const home = { latDeg: 47.397742, lonDeg: 8.545594 };
    const vehicle = destinationPoint(home, 90, 500);
    const relative = relativeToHome(home, vehicle);
    expect(relative.distanceM).toBeCloseTo(500, 5);
    expect(relative.bearingDeg).toBeCloseTo(90, 4);
    // Not exactly 270: on a sphere the reciprocal of a great-circle bearing
    // differs from bearing + 180 by the convergence of the meridians, which at
    // 47 degrees north over 500 m is about 0.005 degrees.
    expect(relative.reciprocalBearingDeg).toBeCloseTo(270, 2);
  });

  it('signs cross-track distance right of track as positive', () => {
    const from = { latDeg: 0, lonDeg: 0 };
    const to = { latDeg: 0, lonDeg: 1 };
    const rightOfTrack = { latDeg: -0.01, lonDeg: 0.5 };
    expect(crossTrackDistanceM(from, to, rightOfTrack)).toBeGreaterThan(0);
    expect(crossTrackDistanceM(from, to, { latDeg: 0.01, lonDeg: 0.5 })).toBeLessThan(0);
  });
});

describe('geofence', () => {
  const square = [
    { latDeg: 0, lonDeg: 0 },
    { latDeg: 0, lonDeg: 1 },
    { latDeg: 1, lonDeg: 1 },
    { latDeg: 1, lonDeg: 0 },
  ];

  it('contains interior points and excludes exterior ones', () => {
    expect(pointInPolygon({ latDeg: 0.5, lonDeg: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ latDeg: 1.5, lonDeg: 0.5 }, square)).toBe(false);
    expect(pointInPolygon({ latDeg: 0.5, lonDeg: -0.001 }, square)).toBe(false);
  });

  it('handles a concave polygon, where a bounding box would not', () => {
    const lShape = [
      { latDeg: 0, lonDeg: 0 },
      { latDeg: 0, lonDeg: 2 },
      { latDeg: 1, lonDeg: 2 },
      { latDeg: 1, lonDeg: 1 },
      { latDeg: 2, lonDeg: 1 },
      { latDeg: 2, lonDeg: 0 },
    ];
    expect(pointInPolygon({ latDeg: 0.5, lonDeg: 1.5 }, lShape)).toBe(true);
    expect(pointInPolygon({ latDeg: 1.5, lonDeg: 1.5 }, lShape)).toBe(false);
  });

  it('rejects a degenerate polygon instead of throwing', () => {
    expect(pointInPolygon({ latDeg: 0, lonDeg: 0 }, [{ latDeg: 0, lonDeg: 0 }])).toBe(false);
  });

  it('reports lateral breach and margin for a circular fence', () => {
    const centre = { latDeg: 47.397742, lonDeg: 8.545594 };
    const fence = { kind: 'circle' as const, centre, radiusM: 200 };
    const inside = checkGeofence(fence, destinationPoint(centre, 30, 150));
    expect(inside.inside).toBe(true);
    expect(inside.lateralMarginM).toBeCloseTo(50, 3);

    const outside = checkGeofence(fence, destinationPoint(centre, 30, 260));
    expect(outside.inside).toBe(false);
    expect(outside.reasons).toContain('lateral');
    expect(outside.lateralMarginM).toBeCloseTo(-60, 3);
  });

  it('reports ceiling and floor breaches separately', () => {
    const fence = {
      kind: 'circle' as const,
      centre: { latDeg: 0, lonDeg: 0 },
      radiusM: 1000,
      maxAltM: 120,
      minAltM: 5,
    };
    expect(checkGeofence(fence, { latDeg: 0, lonDeg: 0, altM: 130 }).reasons).toEqual(['ceiling']);
    expect(checkGeofence(fence, { latDeg: 0, lonDeg: 0, altM: 2 }).reasons).toEqual(['floor']);
    expect(checkGeofence(fence, { latDeg: 0, lonDeg: 0, altM: 60 }).inside).toBe(true);
  });
});

describe('coordinate formatting', () => {
  it('formats degrees, minutes and seconds with a hemisphere', () => {
    expect(formatDms(51.4779, 'lat')).toBe('51°28\'40.4"N');
    expect(formatDms(-0.0015, 'lon')).toBe('000°00\'05.4"W');
    expect(formatDms(8.545594, 'lon')).toBe('008°32\'44.1"E');
  });

  it('carries the rounding instead of printing 60 seconds', () => {
    expect(formatDms(0.999999861, 'lat')).toBe('01°00\'00.0"N');
  });

  it('formats decimal degrees at centimetre resolution', () => {
    expect(formatPointDecimal({ latDeg: 47.397742, lonDeg: 8.545594 })).toBe(
      '47.3977420, 8.5455940',
    );
  });

  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(23)).toBe('NNE');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(359)).toBe('N');
  });
});
