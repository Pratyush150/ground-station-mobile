import { describe, expect, it } from 'vitest';

import { DemoLink, DemoLinkConfig } from '../src/core/link';
import { ManualScheduler } from '../src/core/platform/scheduler';
import { FrameParser, decodeMessage } from '../src/core/telemetry/decode';
import { VehicleStateStore } from '../src/core/state/vehicle';
import { haversineDistanceM } from '../src/core/geo';
import { missionIsFlyable, validateMission } from '../src/core/mission';
import { DEMO_HOME } from '../src/core/link/demo';

/** Run a demo link for `ticks` scheduler fires and return everything it sent. */
async function runDemo(config: DemoLinkConfig, ticks: number) {
  const scheduler = new ManualScheduler();
  const link = new DemoLink(config, { scheduler });
  const chunks: Uint8Array[] = [];
  link.onBytes((bytes) => chunks.push(bytes));
  await link.open();
  scheduler.runIntervals(ticks);
  return { link, scheduler, chunks };
}

function hex(chunks: Uint8Array[]): string {
  return chunks
    .map((chunk) => [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
    .join('|');
}

/** Feed a demo run through the real parser and state store. */
function ingest(chunks: Uint8Array[], nowMs = 0) {
  const parser = new FrameParser();
  const store = new VehicleStateStore();
  for (const chunk of chunks) {
    for (const frame of parser.push(chunk)) {
      const message = decodeMessage(frame);
      if (message !== null) store.apply(message, nowMs);
    }
  }
  store.applyLinkStats(parser.stats, nowMs);
  return { parser, store };
}

describe('DemoLink', () => {
  it('produces byte-identical output for the same seed', async () => {
    const first = await runDemo({ kind: 'demo', seed: 1337 }, 300);
    const second = await runDemo({ kind: 'demo', seed: 1337 }, 300);
    expect(first.chunks.length).toBeGreaterThan(0);
    expect(hex(first.chunks)).toBe(hex(second.chunks));
  });

  it('produces different output for a different seed', async () => {
    const first = await runDemo({ kind: 'demo', seed: 1 }, 300);
    const second = await runDemo({ kind: 'demo', seed: 2 }, 300);
    expect(hex(first.chunks)).not.toBe(hex(second.chunks));
  });

  it('emits frames the real parser accepts, with no CRC errors', async () => {
    const { chunks } = await runDemo({ kind: 'demo', seed: 7 }, 200);
    const { parser } = ingest(chunks);
    expect(parser.stats.framesDecoded).toBeGreaterThan(50);
    expect(parser.stats.crcErrors).toBe(0);
    expect(parser.stats.framesLost).toBe(0);
    expect(parser.stats.bytesDropped).toBe(0);
  });

  it('flies a recognisable profile: disarmed, then takeoff, then mission', async () => {
    const early = ingest((await runDemo({ kind: 'demo', seed: 7 }, 60)).chunks); // 3 s
    expect(early.store.current.armedState?.armed).toBe(false);
    expect(early.store.current.mode?.name).toBe('POSCTL');

    const climbing = ingest((await runDemo({ kind: 'demo', seed: 7 }, 200)).chunks); // 10 s
    expect(climbing.store.current.armedState?.armed).toBe(true);
    expect(climbing.store.current.mode?.name).toBe('AUTO.TAKEOFF');
    expect(climbing.store.current.position?.altRelM ?? 0).toBeGreaterThan(5);

    const enRoute = ingest((await runDemo({ kind: 'demo', seed: 7 }, 700)).chunks); // 35 s
    expect(enRoute.store.current.mode?.name).toBe('AUTO.MISSION');
    expect(enRoute.store.current.position?.altRelM ?? 0).toBeCloseTo(40, 0);
    expect(enRoute.store.groundspeedMs() ?? 0).toBeGreaterThan(5);
  });

  it('leaves home and comes back for landing', async () => {
    const { store } = ingest((await runDemo({ kind: 'demo', seed: 7 }, 700)).chunks);
    const away = store.positionPoint();
    expect(away).not.toBeNull();
    expect(haversineDistanceM(DEMO_HOME, away!)).toBeGreaterThan(50);

    const landed = ingest((await runDemo({ kind: 'demo', seed: 7 }, 3200)).chunks); // 160 s
    const finalPoint = landed.store.positionPoint();
    expect(haversineDistanceM(DEMO_HOME, finalPoint!)).toBeLessThan(20);
    expect(landed.store.current.position?.altRelM ?? 99).toBeLessThan(1);
    expect(landed.store.current.armedState?.armed).toBe(false);
  });

  it('sets a home point from the first fix received while armed', async () => {
    const { store } = ingest((await runDemo({ kind: 'demo', seed: 7 }, 200)).chunks);
    expect(store.current.home).not.toBeNull();
    expect(haversineDistanceM(DEMO_HOME, store.current.home!)).toBeLessThan(30);
  });

  it('injects CRC errors when the corruption fault is enabled', async () => {
    const { chunks } = await runDemo(
      { kind: 'demo', seed: 7, faults: { corruptEveryNthFrame: 5 } },
      200,
    );
    const { parser } = ingest(chunks);
    expect(parser.stats.crcErrors).toBeGreaterThan(10);
    expect(parser.stats.framesDecoded).toBeGreaterThan(0);
    // Dropped frames leave sequence gaps, which is exactly what a marginal
    // radio link looks like on the diagnostics screen.
    expect(parser.stats.framesLost).toBeGreaterThan(0);
  });

  it('goes quiet during an injected dropout and comes back afterwards', async () => {
    const scheduler = new ManualScheduler();
    const link = new DemoLink(
      { kind: 'demo', seed: 7, faults: { linkDropoutAtS: 6, linkDropoutDurationS: 4 } },
      { scheduler },
    );
    let framesInDropout = 0;
    let framesAfter = 0;
    let elapsedMs = 0;
    link.onBytes(() => {
      if (elapsedMs >= 6000 && elapsedMs < 10000) framesInDropout += 1;
      if (elapsedMs >= 10000) framesAfter += 1;
    });
    await link.open();
    for (let i = 0; i < 300; i += 1) {
      elapsedMs += DemoLink.TICK_MS;
      scheduler.runIntervals(1);
    }
    expect(framesInDropout).toBe(0);
    expect(framesAfter).toBeGreaterThan(50);
  });

  it('leaves a counted sequence gap behind a dropout', async () => {
    const { chunks } = await runDemo(
      { kind: 'demo', seed: 7, faults: { linkDropoutAtS: 6, linkDropoutDurationS: 4 } },
      300,
    );
    const { parser } = ingest(chunks);
    // Roughly 24 frames per second of stream, four seconds missing.
    expect(parser.stats.framesLost).toBeGreaterThan(50);
    expect(parser.stats.crcErrors).toBe(0);
    expect(parser.stats.framesDecoded).toBeGreaterThan(200);
  });

  it('degrades the GPS on schedule', async () => {
    const { chunks } = await runDemo(
      { kind: 'demo', seed: 7, faults: { gpsDegradeAtS: 5, gpsDegradeDurationS: 30 } },
      300,
    );
    const { store } = ingest(chunks);
    expect(store.current.gps?.satellitesVisible).toBe(4);
    expect(store.current.gps?.fixType).toBe(2);
  });

  it('stops its timer on close', async () => {
    const { link, scheduler } = await runDemo({ kind: 'demo', seed: 7 }, 10);
    expect(scheduler.activeIntervals).toBe(1);
    await link.close();
    expect(scheduler.activeIntervals).toBe(0);
    expect(link.status.state).toBe('closed');
  });

  it('ships a mission that passes validation', () => {
    const link = new DemoLink({ kind: 'demo', seed: 7 }, { scheduler: new ManualScheduler() });
    const issues = validateMission(link.mission);
    expect(missionIsFlyable(issues)).toBe(true);
    expect(link.mission.items.length).toBeGreaterThan(4);
  });
});
