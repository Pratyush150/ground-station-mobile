import { describe, expect, it } from 'vitest';

import { AlertContext, AlertEngine, DEFAULT_THRESHOLDS, buildDefaultRules } from '../src/core/alerts';
import { GpsFixType } from '../src/core/telemetry/types';

function context(nowMs: number, overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    nowMs,
    armed: true,
    battery: { remainingPct: 100, voltageV: 25.2, cellVoltageV: 4.2 },
    linkAgeMs: 100,
    gps: { fixType: GpsFixType.Fix3D, satellitesVisible: 14, hdop: 0.8 },
    geofence: null,
    staleFields: [],
    ...overrides,
  };
}

function battery(nowMs: number, pct: number): AlertContext {
  return context(nowMs, { battery: { remainingPct: pct, voltageV: 22, cellVoltageV: 3.7 } });
}

describe('alert engine', () => {
  it('starts with nothing active', () => {
    const engine = new AlertEngine(buildDefaultRules());
    expect(engine.update(context(0))).toHaveLength(0);
    expect(engine.highest()).toBeNull();
  });

  it('does not raise an alert for a transient dip shorter than the on-delay', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, 40));
    engine.update(battery(1000, 24));
    engine.update(battery(2000, 40)); // recovered well before the 3 s on-delay
    expect(engine.isActive('battery-low')).toBe(false);
    expect(engine.history()).toHaveLength(0);
  });

  it('raises once the condition has held for the on-delay', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, 24));
    expect(engine.isActive('battery-low')).toBe(false); // pending
    engine.update(battery(2999, 24));
    expect(engine.isActive('battery-low')).toBe(false);
    engine.update(battery(3000, 24));
    expect(engine.isActive('battery-low')).toBe(true);
    expect(engine.history().filter((event) => event.kind === 'raised')).toHaveLength(1);
  });

  it('does not chatter while the value dithers on the threshold', () => {
    const engine = new AlertEngine(buildDefaultRules());
    // Hold below the trigger long enough to latch.
    engine.update(battery(0, 24));
    engine.update(battery(3000, 24));
    expect(engine.isActive('battery-low')).toBe(true);

    // Now oscillate across the 25 % trigger for 20 s. The clear threshold is
    // 30 %, so none of this should produce a single extra event.
    let now = 3000;
    for (let i = 0; i < 40; i += 1) {
      now += 500;
      engine.update(battery(now, i % 2 === 0 ? 24.9 : 25.1));
    }
    expect(engine.isActive('battery-low')).toBe(true);
    expect(engine.history()).toHaveLength(1);
  });

  it('clears only after the value passes the clear threshold for the off-delay', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, 24));
    engine.update(battery(3000, 24));
    expect(engine.isActive('battery-low')).toBe(true);

    engine.update(battery(4000, 31)); // above clear threshold, off-delay starts
    expect(engine.phaseOf('battery-low')).toBe('clearing');
    engine.update(battery(6000, 31));
    expect(engine.isActive('battery-low')).toBe(true); // 5 s off-delay not done
    engine.update(battery(9000, 31));
    expect(engine.isActive('battery-low')).toBe(false);
    expect(engine.history().filter((event) => event.kind === 'cleared')).toHaveLength(1);
  });

  it('returns to active if the value drops again during the off-delay', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, 24));
    engine.update(battery(3000, 24));
    engine.update(battery(4000, 31));
    expect(engine.phaseOf('battery-low')).toBe('clearing');
    engine.update(battery(5000, 24));
    expect(engine.phaseOf('battery-low')).toBe('active');
    expect(engine.history()).toHaveLength(1);
  });

  it('raises link loss immediately at the age threshold and sorts it above battery', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, 24));
    engine.update(battery(3000, 24));
    const active = engine.update(
      context(4000, {
        battery: { remainingPct: 24, voltageV: 22, cellVoltageV: 3.7 },
        linkAgeMs: DEFAULT_THRESHOLDS.linkLossMs,
      }),
    );
    expect(engine.isActive('link-loss')).toBe(true);
    expect(active[0].id).toBe('link-loss');
    expect(active[0].severity).toBe('critical');
  });

  it('holds link loss through a single late frame inside the hysteresis band', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(context(0, { linkAgeMs: 4000 }));
    expect(engine.isActive('link-loss')).toBe(true);
    // 2 s is below the 3 s loss threshold but above the 1.5 s recovery
    // threshold, so it must not clear.
    engine.update(context(1000, { linkAgeMs: 2000 }));
    engine.update(context(5000, { linkAgeMs: 2000 }));
    expect(engine.isActive('link-loss')).toBe(true);
    engine.update(context(6000, { linkAgeMs: 200 }));
    engine.update(context(8000, { linkAgeMs: 200 }));
    expect(engine.isActive('link-loss')).toBe(false);
  });

  it('needs a clearly good fix to clear a GPS alert, not just a marginal one', () => {
    const engine = new AlertEngine(buildDefaultRules());
    const degraded = { fixType: GpsFixType.Fix2D, satellitesVisible: 4, hdop: 4.2 };
    engine.update(context(0, { gps: degraded }));
    engine.update(context(4000, { gps: degraded }));
    expect(engine.isActive('gps-degraded')).toBe(true);

    // 3D fix but only 7 satellites: above the trigger, below the clear.
    engine.update(context(5000, { gps: { fixType: GpsFixType.Fix3D, satellitesVisible: 7, hdop: 2.6 } }));
    engine.update(context(12000, { gps: { fixType: GpsFixType.Fix3D, satellitesVisible: 7, hdop: 2.6 } }));
    expect(engine.isActive('gps-degraded')).toBe(true);

    const good = { fixType: GpsFixType.Fix3D, satellitesVisible: 12, hdop: 0.9 };
    engine.update(context(13000, { gps: good }));
    engine.update(context(18000, { gps: good }));
    expect(engine.isActive('gps-degraded')).toBe(false);
  });

  it('raises a geofence breach with no delay and holds it near the boundary', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(context(0, { geofence: { inside: false, reasons: ['lateral'], lateralMarginM: -12 } }));
    expect(engine.isActive('geofence-breach')).toBe(true);

    // Back inside, but only just: the clear margin is 10 m.
    engine.update(context(1000, { geofence: { inside: true, reasons: [], lateralMarginM: 3 } }));
    engine.update(context(5000, { geofence: { inside: true, reasons: [], lateralMarginM: 3 } }));
    expect(engine.isActive('geofence-breach')).toBe(true);

    engine.update(context(6000, { geofence: { inside: true, reasons: [], lateralMarginM: 40 } }));
    engine.update(context(9000, { geofence: { inside: true, reasons: [], lateralMarginM: 40 } }));
    expect(engine.isActive('geofence-breach')).toBe(false);
  });

  it('raises stale telemetry and names the fields that went quiet', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(context(0, { staleFields: ['attitude', 'position'] }));
    expect(engine.isActive('stale-telemetry')).toBe(false); // on-delay
    const active = engine.update(context(2000, { staleFields: ['attitude', 'position'] }));
    const stale = active.find((alert) => alert.id === 'stale-telemetry');
    expect(stale).toBeDefined();
    expect(stale?.message).toContain('attitude');
  });

  it('treats an unknown battery estimate as no information, not as empty', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, -1));
    engine.update(battery(10000, -1));
    expect(engine.isActive('battery-low')).toBe(false);
    expect(engine.isActive('battery-critical')).toBe(false);
  });

  it('raises critical before low and orders the active list by severity', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, 12));
    const active = engine.update(battery(4000, 12));
    expect(active.map((alert) => alert.id)).toEqual(['battery-critical', 'battery-low']);
  });

  it('forgets everything on reset', () => {
    const engine = new AlertEngine(buildDefaultRules());
    engine.update(battery(0, 10));
    engine.update(battery(4000, 10));
    expect(engine.active().length).toBeGreaterThan(0);
    engine.reset();
    expect(engine.active()).toHaveLength(0);
    expect(engine.history()).toHaveLength(0);
  });
});
