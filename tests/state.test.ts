import { describe, expect, it } from 'vitest';

import { AlertEngine, buildDefaultRules } from '../src/core/alerts';
import { DemoLink } from '../src/core/link';
import { ManualScheduler } from '../src/core/platform/scheduler';
import { VehicleStateStore } from '../src/core/state/vehicle';
import { FrameParser, decodeMessage } from '../src/core/telemetry/decode';

describe('VehicleStateStore', () => {
  it('starts empty and reports every critical field as stale', () => {
    const store = new VehicleStateStore();
    expect(store.current.mode).toBeNull();
    expect(store.current.position).toBeNull();
    expect(store.staleFields(0)).toEqual(['attitude', 'position', 'battery', 'heartbeat']);
  });

  it('replaces the state object on every update so a UI can compare by identity', () => {
    const store = new VehicleStateStore();
    const before = store.current;
    store.apply(
      {
        type: 'attitude',
        timeBootMs: 1,
        rollRad: 0.1,
        pitchRad: 0,
        yawRad: 0,
        rollRateRadS: 0,
        pitchRateRadS: 0,
        yawRateRadS: 0,
      },
      1000,
    );
    expect(store.current).not.toBe(before);
    expect(store.current.attitude?.rollRad).toBeCloseTo(0.1, 6);
    expect(store.current.updatedAtMs).toBe(1000);
  });

  it('prefers VFR_HUD groundspeed and falls back to the velocity vector', () => {
    const store = new VehicleStateStore();
    store.apply(
      {
        type: 'global_position_int',
        timeBootMs: 1,
        latDeg: 47.4,
        lonDeg: 8.5,
        altAmslM: 500,
        altRelM: 40,
        vxMs: 3,
        vyMs: 4,
        vzMs: 0,
        headingDeg: 53,
      },
      1000,
    );
    expect(store.groundspeedMs()).toBeCloseTo(5, 6); // hypot(3, 4)

    store.apply(
      {
        type: 'vfr_hud',
        airspeedMs: 11,
        groundspeedMs: 9.5,
        altAmslM: 500,
        climbRateMs: 0,
        headingDeg: 53,
        throttlePct: 45,
      },
      1000,
    );
    expect(store.groundspeedMs()).toBeCloseTo(9.5, 6);
  });

  it('computes a link loss rate from decoded and lost frame counts', () => {
    const store = new VehicleStateStore();
    const state = store.applyLinkStats(
      { framesDecoded: 90, crcErrors: 2, framesLost: 10, bytesDropped: 40 },
      5000,
    );
    expect(state.link.lossRatePct).toBeCloseTo(10, 6);
    expect(state.link.lastFrameAtMs).toBe(5000);
  });

  it('ages fields independently once the stream stops', () => {
    const store = new VehicleStateStore();
    store.apply(
      {
        type: 'attitude',
        timeBootMs: 1,
        rollRad: 0,
        pitchRad: 0,
        yawRad: 0,
        rollRateRadS: 0,
        pitchRateRadS: 0,
        yawRateRadS: 0,
      },
      1000,
    );
    expect(store.freshness.isStale('attitude', 1500)).toBe(false);
    expect(store.freshness.isStale('attitude', 2500)).toBe(true);
    expect(store.freshness.freshness('attitude', 2500).ageMs).toBe(1500);
  });
});

describe('link to alert pipeline', () => {
  it('carries a demo dropout all the way through to a stale-telemetry alert', async () => {
    const scheduler = new ManualScheduler();
    const link = new DemoLink(
      { kind: 'demo', seed: 99, faults: { linkDropoutAtS: 10, linkDropoutDurationS: 20 } },
      { scheduler },
    );
    const parser = new FrameParser();
    const store = new VehicleStateStore();
    const engine = new AlertEngine(buildDefaultRules());

    let nowMs = 0;
    link.onBytes((bytes) => {
      for (const frame of parser.push(bytes)) {
        const message = decodeMessage(frame);
        if (message !== null) store.apply(message, nowMs);
      }
    });
    await link.open();

    const stepTo = (targetMs: number) => {
      while (nowMs < targetMs) {
        nowMs += DemoLink.TICK_MS;
        scheduler.runIntervals(1);
        engine.update({
          nowMs,
          armed: store.current.armedState?.armed ?? false,
          battery: store.current.battery
            ? {
                remainingPct: store.current.battery.remainingPct,
                voltageV: store.current.battery.voltageV,
                cellVoltageV: null,
              }
            : null,
          linkAgeMs:
            store.current.link.lastFrameAtMs === null
              ? null
              : nowMs - store.current.link.lastFrameAtMs,
          gps: store.current.gps,
          geofence: null,
          staleFields: store.staleFields(nowMs),
        });
        store.applyLinkStats(parser.stats, nowMs);
      }
    };

    stepTo(9000);
    expect(engine.isActive('stale-telemetry')).toBe(false);

    stepTo(16000); // 6 s into a 20 s dropout
    expect(engine.isActive('stale-telemetry')).toBe(true);
    expect(engine.isActive('link-loss')).toBe(true);
    expect(engine.highest()?.id).toBe('link-loss');

    stepTo(36000); // telemetry has been back for 6 s
    expect(engine.isActive('link-loss')).toBe(false);
    expect(engine.isActive('stale-telemetry')).toBe(false);

    await link.close();
  });
});
