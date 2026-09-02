#!/usr/bin/env node
/**
 * Run the demo flight from the command line, with no phone involved.
 *
 * Drives exactly the pipeline the app uses - demo link, frame parser, message
 * decode, vehicle state store, alert engine - and prints a line per simulated
 * five seconds. Useful for checking a change to the core without opening a
 * simulator, and as the first thing to run on a fresh checkout.
 *
 *   npm run demo
 *   npm run demo -- --faults    inject a dropout, GPS degradation and fast drain
 */

const { DemoLink } = require('../dist/link/demo');
const { ManualScheduler } = require('../dist/platform/scheduler');
const { FrameParser, decodeMessage } = require('../dist/telemetry/decode');
const { VehicleStateStore } = require('../dist/state/vehicle');
const { AlertEngine, buildDefaultRules } = require('../dist/alerts');
const { relativeToHome } = require('../dist/geo/distance');
const { computeProgress } = require('../dist/mission/progress');

const withFaults = process.argv.includes('--faults');
const faults = withFaults
  ? {
      linkDropoutAtS: 45,
      linkDropoutDurationS: 8,
      gpsDegradeAtS: 80,
      gpsDegradeDurationS: 25,
      batteryDrainMultiplier: 9,
    }
  : undefined;

const scheduler = new ManualScheduler();
const link = new DemoLink({ kind: 'demo', seed: 1337, faults }, { scheduler });
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

const pad = (text, width) => String(text).padStart(width);

async function main() {
  await link.open();
  console.log(`Demo flight, seed 1337${withFaults ? ' (faults injected)' : ''}`);
  console.log('  T+s  mode          alt   spd  home  batt  sats  link  alerts');

  const totalMs = 120_000;
  while (nowMs < totalMs) {
    nowMs += DemoLink.TICK_MS;
    scheduler.runIntervals(1);
    store.applyLinkStats(parser.stats, nowMs);

    const vehicle = store.current;
    const linkAgeMs =
      vehicle.link.lastFrameAtMs === null ? null : nowMs - vehicle.link.lastFrameAtMs;
    const alerts = engine.update({
      nowMs,
      armed: vehicle.armedState ? vehicle.armedState.armed : false,
      battery: vehicle.battery
        ? {
            remainingPct: vehicle.battery.remainingPct,
            voltageV: vehicle.battery.voltageV,
            cellVoltageV: null,
          }
        : null,
      linkAgeMs,
      gps: vehicle.gps,
      geofence: null,
      staleFields: store.staleFields(nowMs),
    });

    if (nowMs % 10_000 !== 0) continue;

    const position = store.positionPoint();
    const home = vehicle.home;
    const distance = home && position ? relativeToHome(home, position).distanceM : 0;
    console.log(
      [
        pad((nowMs / 1000).toFixed(0), 5),
        (vehicle.mode ? vehicle.mode.name : '--').padEnd(13),
        pad(position ? position.altM.toFixed(0) + 'm' : '--', 5),
        pad((store.groundspeedMs() || 0).toFixed(1), 5),
        pad(distance.toFixed(0) + 'm', 6),
        pad(vehicle.battery ? Math.round(vehicle.battery.remainingPct) + '%' : '--', 5),
        pad(vehicle.gps ? vehicle.gps.satellitesVisible : '--', 5),
        pad(linkAgeMs === null ? '--' : (linkAgeMs / 1000).toFixed(1) + 's', 6),
        '  ' + (alerts.length === 0 ? '-' : alerts.map((alert) => alert.id).join(', ')),
      ].join(' '),
    );
  }

  await link.close();

  const progress = computeProgress({
    mission: link.mission,
    currentSeq: store.current.currentWaypointSeq,
    vehicle: store.positionPoint(),
    groundspeedMs: store.groundspeedMs(),
  });

  console.log('');
  console.log('link   ', JSON.stringify(store.current.link));
  console.log('mission', `${(progress.completedFraction * 100).toFixed(0)}% of ${progress.totalDistanceM.toFixed(0)} m planned`);
  console.log('events ', engine.history().length);
  for (const event of engine.history()) {
    console.log(`   T+${(event.atMs / 1000).toFixed(1)}s ${event.kind} ${event.id}: ${event.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
