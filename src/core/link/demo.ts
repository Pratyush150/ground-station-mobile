/**
 * Deterministic demo link.
 *
 * The app has to be usable on a train, in a meeting, or during a first run
 * before anyone has powered an aircraft. `DemoLink` synthesises a complete
 * flight - arm, takeoff, four-waypoint run, return to launch, land - and emits
 * it as real MAVLink frames, so every layer above it (parser, state store,
 * alert engine, screens) is exercised exactly as it would be in the field.
 *
 * Determinism is a hard requirement, not a nicety: the same seed and the same
 * number of ticks must produce byte-identical output, otherwise it cannot be
 * used as a test fixture or to reproduce a UI bug.
 */

import { destinationPoint, haversineDistanceM, initialBearingDeg, normaliseDeg } from '../geo/distance';
import { Mission, MavCmd, MavFrame, MissionItem, waypoint } from '../mission/types';
import { ByteWriter } from '../telemetry/binary';
import { MessageId, encodeFrameV1 } from '../telemetry/decode';
import { encodePx4Mode } from '../telemetry/modes';
import { Scheduler, TimerHandle, systemScheduler } from '../platform/scheduler';
import { GeoPoint } from '../telemetry/types';
import {
  DemoFaults,
  DemoLinkConfig,
  Emitter,
  LinkStatus,
  TelemetryLink,
  Unsubscribe,
  describeLink,
} from './types';

/**
 * Home for the demo flight: the default PX4 SITL start position.
 *
 * Using the same coordinates as SITL means a screenshot from demo mode and a
 * screenshot from a simulator session look like the same place.
 */
export const DEMO_HOME: GeoPoint = { latDeg: 47.397742, lonDeg: 8.545594, altM: 488 };

/** Cruise altitude above home, metres. */
const CRUISE_ALT_M = 40;
/** RTL altitude above home, metres. */
const RTL_ALT_M = 50;
const CRUISE_SPEED_MS = 12;
const CLIMB_RATE_MS = 2.5;
const DESCENT_RATE_MS = 1.5;
const WAYPOINT_ACCEPTANCE_M = 8;
const MAX_TURN_RATE_DEG_S = 45;
const PACK_CAPACITY_MAH = 5200;
const CELL_COUNT = 6;

/** System and component IDs the demo vehicle reports. */
const DEMO_SYSTEM_ID = 1;
const DEMO_COMPONENT_ID = 1;

/**
 * mulberry32: a small, fast, well-distributed 32-bit PRNG.
 *
 * `Math.random` cannot be used anywhere in here - it would make the demo
 * unreproducible and the determinism test meaningless.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The demo mission: a box to the north-east of home, then home again. */
export function buildDemoMission(): Mission {
  const legs: Array<{ bearing: number; distance: number }> = [
    { bearing: 45, distance: 180 },
    { bearing: 135, distance: 180 },
    { bearing: 225, distance: 180 },
    { bearing: 315, distance: 180 },
  ];

  const items: MissionItem[] = [
    {
      seq: 0,
      command: MavCmd.NavTakeoff,
      frame: MavFrame.GlobalRelativeAltInt,
      latDeg: DEMO_HOME.latDeg,
      lonDeg: DEMO_HOME.lonDeg,
      altM: CRUISE_ALT_M,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      autocontinue: true,
    },
  ];

  let cursor: GeoPoint = DEMO_HOME;
  legs.forEach((leg, index) => {
    cursor = destinationPoint(cursor, leg.bearing, leg.distance);
    items.push(waypoint(index + 1, cursor.latDeg, cursor.lonDeg, CRUISE_ALT_M));
  });

  items.push({
    seq: items.length,
    command: MavCmd.NavReturnToLaunch,
    frame: MavFrame.Mission,
    latDeg: 0,
    lonDeg: 0,
    altM: 0,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    autocontinue: true,
  });

  return { items, home: { latDeg: DEMO_HOME.latDeg, lonDeg: DEMO_HOME.lonDeg, altM: DEMO_HOME.altM ?? 0 }, name: 'Demo box' };
}

export type DemoPhase = 'preflight' | 'takeoff' | 'mission' | 'rtl' | 'land' | 'complete';

/** Everything the simulator knows at one instant. */
export interface DemoSnapshot {
  timeMs: number;
  phase: DemoPhase;
  armed: boolean;
  customMode: number;
  baseMode: number;
  latDeg: number;
  lonDeg: number;
  /** Altitude above home, metres. */
  altRelM: number;
  headingDeg: number;
  groundspeedMs: number;
  climbRateMs: number;
  rollRad: number;
  pitchRad: number;
  yawRad: number;
  batteryPct: number;
  voltageV: number;
  currentA: number;
  consumedMah: number;
  satellites: number;
  fixType: number;
  hdop: number;
  currentSeq: number;
  throttlePct: number;
}

/** PX4 main modes used by the demo, packed into `custom_mode`. */
const MODE_POSCTL = encodePx4Mode(3);
const MODE_AUTO_TAKEOFF = encodePx4Mode(4, 2);
const MODE_AUTO_MISSION = encodePx4Mode(4, 4);
const MODE_AUTO_RTL = encodePx4Mode(4, 5);
const MODE_AUTO_LAND = encodePx4Mode(4, 6);

/**
 * Kinematic model of a multirotor flying a mission.
 *
 * Not a dynamics simulation: it is a smooth first-order model that produces
 * plausible attitude, speed and battery traces. The point is to drive the UI
 * and the alert thresholds through realistic transitions, not to model rotor
 * aerodynamics.
 */
export class DemoFlightSimulator {
  private readonly random: () => number;

  private readonly mission = buildDemoMission();

  private readonly waypoints: GeoPoint[];

  private timeMs = 0;

  private phase: DemoPhase = 'preflight';

  private targetIndex = 0;

  private latDeg = DEMO_HOME.latDeg;

  private lonDeg = DEMO_HOME.lonDeg;

  private altRelM = 0;

  private headingDeg = 0;

  private groundspeedMs = 0;

  private climbRateMs = 0;

  private rollRad = 0;

  private pitchRad = 0;

  private consumedMah = 0;

  private readonly faults: DemoFaults;

  constructor(seed: number, faults: DemoFaults = {}) {
    this.random = mulberry32(seed);
    this.faults = faults;
    this.waypoints = this.mission.items
      .filter((item) => item.command === MavCmd.NavWaypoint)
      .map((item) => ({ latDeg: item.latDeg, lonDeg: item.lonDeg, altM: item.altM }));
  }

  /** The mission the simulated vehicle is flying. */
  get plan(): Mission {
    return this.mission;
  }

  /** Advance the model by `dtMs` and return the new snapshot. */
  step(dtMs: number): DemoSnapshot {
    const dt = dtMs / 1000;
    this.timeMs += dtMs;
    const t = this.timeMs / 1000;

    switch (this.phase) {
      case 'preflight':
        if (t >= 5) this.phase = 'takeoff';
        break;
      case 'takeoff':
        this.climbTo(CRUISE_ALT_M, dt);
        if (this.altRelM >= CRUISE_ALT_M - 0.5) {
          this.phase = 'mission';
          this.targetIndex = 0;
        }
        break;
      case 'mission': {
        const target = this.waypoints[this.targetIndex];
        if (target === undefined) {
          this.phase = 'rtl';
          break;
        }
        this.flyTowards(target, CRUISE_SPEED_MS, CRUISE_ALT_M, dt);
        if (haversineDistanceM(this.position(), target) <= WAYPOINT_ACCEPTANCE_M) {
          this.targetIndex += 1;
        }
        break;
      }
      case 'rtl':
        this.flyTowards(DEMO_HOME, CRUISE_SPEED_MS, RTL_ALT_M, dt);
        if (haversineDistanceM(this.position(), DEMO_HOME) <= WAYPOINT_ACCEPTANCE_M) {
          this.phase = 'land';
        }
        break;
      case 'land':
        this.groundspeedMs = Math.max(0, this.groundspeedMs - 4 * dt);
        this.climbTo(0, dt);
        if (this.altRelM <= 0.05) {
          this.altRelM = 0;
          this.phase = 'complete';
        }
        break;
      default:
        this.groundspeedMs = 0;
        this.climbRateMs = 0;
        break;
    }

    this.drainBattery(dt);
    return this.snapshot();
  }

  private position(): GeoPoint {
    return { latDeg: this.latDeg, lonDeg: this.lonDeg, altM: this.altRelM };
  }

  private climbTo(targetAltM: number, dt: number): void {
    const error = targetAltM - this.altRelM;
    const rate = error > 0 ? CLIMB_RATE_MS : -DESCENT_RATE_MS;
    const stepM = rate * dt;
    if (Math.abs(stepM) >= Math.abs(error)) {
      this.altRelM = targetAltM;
      this.climbRateMs = 0;
    } else {
      this.altRelM += stepM;
      this.climbRateMs = rate;
    }
  }

  /** Turn towards a target, accelerate towards a cruise speed, hold altitude. */
  private flyTowards(target: GeoPoint, targetSpeedMs: number, targetAltM: number, dt: number): void {
    const bearing = initialBearingDeg(this.position(), target);
    const delta = ((bearing - this.headingDeg + 540) % 360) - 180;
    const maxTurn = MAX_TURN_RATE_DEG_S * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
    this.headingDeg = normaliseDeg(this.headingDeg + turn);

    // Bank into the turn, and slow down while turning hard - a real vehicle
    // cannot hold cruise speed through a 90 degree corner.
    const turnFraction = maxTurn === 0 ? 0 : turn / maxTurn;
    this.rollRad = turnFraction * 0.35 + (this.random() - 0.5) * 0.01;
    const speedLimit = targetSpeedMs * (1 - 0.4 * Math.abs(turnFraction));
    const accel = this.groundspeedMs < speedLimit ? 2.5 : -3.0;
    this.groundspeedMs = Math.max(0, Math.min(speedLimit, this.groundspeedMs + accel * dt));
    this.pitchRad = -(this.groundspeedMs / CRUISE_SPEED_MS) * 0.14 + (this.random() - 0.5) * 0.01;

    const advanced = destinationPoint(this.position(), this.headingDeg, this.groundspeedMs * dt);
    this.latDeg = advanced.latDeg;
    this.lonDeg = advanced.lonDeg;
    this.climbTo(targetAltM, dt);
  }

  /**
   * Battery drain: hover draw plus a climb penalty plus a speed penalty.
   *
   * Linear enough to be predictable, non-constant enough that the low-battery
   * alert fires at a moment that depends on how the flight went.
   */
  private drainBattery(dt: number): void {
    const multiplier = this.faults.batteryDrainMultiplier ?? 1;
    const flying = this.phase !== 'preflight' && this.phase !== 'complete';
    const hoverA = flying ? 22 : 0.8;
    const climbA = Math.max(0, this.climbRateMs) * 3.5;
    const speedA = (this.groundspeedMs / CRUISE_SPEED_MS) * 6;
    const currentA = (hoverA + climbA + speedA) * multiplier;
    this.consumedMah += (currentA * 1000 * dt) / 3600;
    this.lastCurrentA = currentA;
  }

  private lastCurrentA = 0;

  private snapshot(): DemoSnapshot {
    const t = this.timeMs / 1000;
    const batteryPct = Math.max(0, 100 - (this.consumedMah / PACK_CAPACITY_MAH) * 100);
    // 4.20 V/cell full, 3.50 V/cell empty, minus an internal-resistance sag
    // that grows with current draw.
    const restingV = (3.5 + (batteryPct / 100) * 0.7) * CELL_COUNT;
    const voltageV = restingV - this.lastCurrentA * 0.018;

    const degraded =
      this.faults.gpsDegradeAtS !== undefined &&
      t >= this.faults.gpsDegradeAtS &&
      t < this.faults.gpsDegradeAtS + (this.faults.gpsDegradeDurationS ?? 20);

    const armed = this.phase !== 'preflight' && this.phase !== 'complete';
    const customMode = this.modeForPhase();

    return {
      timeMs: this.timeMs,
      phase: this.phase,
      armed,
      customMode,
      // bit0 custom mode enabled, bit7 armed, bit4 stabilise.
      baseMode: 1 | 16 | (armed ? 128 : 0),
      latDeg: this.latDeg,
      lonDeg: this.lonDeg,
      altRelM: this.altRelM,
      headingDeg: this.headingDeg,
      groundspeedMs: this.groundspeedMs,
      climbRateMs: this.climbRateMs,
      rollRad: this.rollRad,
      pitchRad: this.pitchRad,
      yawRad: ((this.headingDeg + 180) % 360) - 180,
      batteryPct,
      voltageV,
      currentA: this.lastCurrentA,
      consumedMah: this.consumedMah,
      satellites: degraded ? 4 : 14,
      fixType: degraded ? 2 : 3,
      hdop: degraded ? 4.2 : 0.8 + this.random() * 0.1,
      currentSeq: this.phase === 'mission' ? this.targetIndex + 1 : this.waypoints.length + 1,
      throttlePct: this.phase === 'preflight' || this.phase === 'complete' ? 0 : 45,
    };
  }

  private modeForPhase(): number {
    switch (this.phase) {
      case 'takeoff':
        return MODE_AUTO_TAKEOFF;
      case 'mission':
        return MODE_AUTO_MISSION;
      case 'rtl':
        return MODE_AUTO_RTL;
      case 'land':
        return MODE_AUTO_LAND;
      default:
        return MODE_POSCTL;
    }
  }
}

interface StreamSpec {
  messageId: MessageId;
  intervalMs: number;
  nextDueMs: number;
  build: (snapshot: DemoSnapshot) => Uint8Array;
}

/**
 * A `TelemetryLink` backed by {@link DemoFlightSimulator}.
 *
 * `open()` drives it from a timer. Tests call `tick()` directly instead, which
 * is why the tick step is a fixed constant rather than a wall-clock delta:
 * wall-clock deltas are exactly what makes a "deterministic" simulator
 * produce different bytes on a loaded machine.
 */
export class DemoLink implements TelemetryLink {
  readonly config: DemoLinkConfig;

  /** Simulated time advanced per tick, milliseconds. */
  static readonly TICK_MS = 50;

  private simulator: DemoFlightSimulator;

  private streams: StreamSpec[] = [];

  private sequence = 0;

  private frameCount = 0;

  private elapsedMs = 0;

  private timer: TimerHandle | null = null;

  private readonly scheduler: Scheduler;

  private currentStatus: LinkStatus;

  private readonly bytes = new Emitter<Uint8Array>();

  private readonly statusEvents = new Emitter<LinkStatus>();

  constructor(config: DemoLinkConfig, options: { scheduler?: Scheduler } = {}) {
    this.config = config;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.simulator = new DemoFlightSimulator(config.seed, config.faults);
    this.currentStatus = {
      state: 'closed',
      sinceMs: 0,
      description: describeLink(config),
    };
    this.streams = this.buildStreams();
  }

  get status(): LinkStatus {
    return this.currentStatus;
  }

  /** The mission the simulated vehicle is flying, for the Mission screen. */
  get mission(): Mission {
    return this.simulator.plan;
  }

  async open(): Promise<void> {
    this.setStatus({ state: 'opening', sinceMs: this.elapsedMs, description: 'Starting demo flight' });
    this.simulator = new DemoFlightSimulator(this.config.seed, this.config.faults);
    this.streams = this.buildStreams();
    this.sequence = 0;
    this.frameCount = 0;
    this.elapsedMs = 0;
    this.setStatus({ state: 'open', sinceMs: 0, description: describeLink(this.config) });
    this.timer = this.scheduler.setInterval(() => this.tick(), DemoLink.TICK_MS);
  }

  async close(): Promise<void> {
    if (this.timer !== null) {
      this.scheduler.clearInterval(this.timer);
      this.timer = null;
    }
    this.setStatus({ state: 'closed', sinceMs: this.elapsedMs, description: 'Demo stopped' });
  }

  async send(_bytes: Uint8Array): Promise<void> {
    // The demo vehicle accepts commands and ignores them. Uplink is not
    // simulated: an app that pretends a command was acted on is worse than
    // one that says it cannot send.
  }

  onBytes(listener: (bytes: Uint8Array) => void): Unsubscribe {
    return this.bytes.subscribe(listener);
  }

  onStatus(listener: (status: LinkStatus) => void): Unsubscribe {
    return this.statusEvents.subscribe(listener);
  }

  /**
   * Advance the simulation one tick and emit whatever frames came due.
   *
   * Public so tests and the record/replay tooling can step it by hand.
   */
  tick(): void {
    this.elapsedMs += DemoLink.TICK_MS;
    const snapshot = this.simulator.step(DemoLink.TICK_MS);

    const faults = this.config.faults ?? {};
    const dropoutStart = (faults.linkDropoutAtS ?? Infinity) * 1000;
    const dropoutEnd = dropoutStart + (faults.linkDropoutDurationS ?? 0) * 1000;
    const inDropout = this.elapsedMs >= dropoutStart && this.elapsedMs < dropoutEnd;

    for (const stream of this.streams) {
      if (this.elapsedMs < stream.nextDueMs) continue;
      stream.nextDueMs += stream.intervalMs;

      const sequence = this.sequence;
      this.sequence = (this.sequence + 1) & 0xff;
      this.frameCount += 1;

      // A dropout is frames lost in the air, not a vehicle that stopped
      // talking, so the sequence numbers keep advancing while nothing is sent.
      // The parser then sees the gap when the link comes back, which is what
      // makes the lost-frame counter mean anything.
      if (inDropout) continue;

      const payload = stream.build(snapshot);
      let frame = encodeFrameV1({
        sequence,
        systemId: DEMO_SYSTEM_ID,
        componentId: DEMO_COMPONENT_ID,
        messageId: stream.messageId,
        payload,
      });

      const corruptEvery = faults.corruptEveryNthFrame ?? 0;
      if (corruptEvery > 0 && this.frameCount % corruptEvery === 0) {
        // Flip a payload bit after the checksum was computed, which is exactly
        // what a marginal radio link does.
        frame = frame.slice();
        const index = 6 + (this.frameCount % Math.max(1, payload.length));
        frame[index] ^= 0x40;
      }
      this.bytes.emit(frame);
    }
  }

  private setStatus(status: LinkStatus): void {
    this.currentStatus = status;
    this.statusEvents.emit(status);
  }

  private buildStreams(): StreamSpec[] {
    const spec = (
      messageId: MessageId,
      hz: number,
      build: (snapshot: DemoSnapshot) => Uint8Array,
    ): StreamSpec => ({
      messageId,
      intervalMs: Math.round(1000 / hz),
      nextDueMs: Math.round(1000 / hz),
      build,
    });

    return [
      spec(MessageId.Heartbeat, 1, buildHeartbeat),
      spec(MessageId.Attitude, 10, buildAttitude),
      spec(MessageId.GlobalPositionInt, 5, buildGlobalPosition),
      spec(MessageId.VfrHud, 5, buildVfrHud),
      spec(MessageId.SysStatus, 2, buildSysStatus),
      spec(MessageId.GpsRawInt, 2, buildGpsRawInt),
      spec(MessageId.MissionCurrent, 1, buildMissionCurrent),
    ];
  }
}

function buildHeartbeat(snapshot: DemoSnapshot): Uint8Array {
  return new ByteWriter(9)
    .writeU32(snapshot.customMode)
    .writeU8(2) // MAV_TYPE_QUADROTOR
    .writeU8(12) // MAV_AUTOPILOT_PX4
    .writeU8(snapshot.baseMode)
    .writeU8(snapshot.armed ? 4 : 3) // ACTIVE / STANDBY
    .writeU8(3) // MAVLink version
    .toBytes();
}

function buildAttitude(snapshot: DemoSnapshot): Uint8Array {
  return new ByteWriter(28)
    .writeU32(snapshot.timeMs)
    .writeF32(snapshot.rollRad)
    .writeF32(snapshot.pitchRad)
    .writeF32(snapshot.yawRad)
    .writeF32(0)
    .writeF32(0)
    .writeF32(0)
    .toBytes();
}

function buildGlobalPosition(snapshot: DemoSnapshot): Uint8Array {
  const headingRad = (snapshot.headingDeg * Math.PI) / 180;
  return new ByteWriter(28)
    .writeU32(snapshot.timeMs)
    .writeI32(Math.round(snapshot.latDeg * 1e7))
    .writeI32(Math.round(snapshot.lonDeg * 1e7))
    .writeI32(Math.round(((DEMO_HOME.altM ?? 0) + snapshot.altRelM) * 1000))
    .writeI32(Math.round(snapshot.altRelM * 1000))
    .writeI16(Math.round(Math.cos(headingRad) * snapshot.groundspeedMs * 100))
    .writeI16(Math.round(Math.sin(headingRad) * snapshot.groundspeedMs * 100))
    .writeI16(Math.round(-snapshot.climbRateMs * 100))
    .writeU16(Math.round(normaliseDeg(snapshot.headingDeg) * 100))
    .toBytes();
}

function buildVfrHud(snapshot: DemoSnapshot): Uint8Array {
  return new ByteWriter(20)
    .writeF32(snapshot.groundspeedMs)
    .writeF32(snapshot.groundspeedMs)
    .writeF32((DEMO_HOME.altM ?? 0) + snapshot.altRelM)
    .writeF32(snapshot.climbRateMs)
    .writeI16(Math.round(normaliseDeg(snapshot.headingDeg)))
    .writeU16(snapshot.throttlePct)
    .toBytes();
}

function buildSysStatus(snapshot: DemoSnapshot): Uint8Array {
  return new ByteWriter(31)
    .writeU32(0)
    .writeU32(0)
    .writeU32(0)
    .writeU16(320) // load, 3.20 %
    .writeU16(Math.round(snapshot.voltageV * 1000))
    .writeI16(Math.round(snapshot.currentA * 100))
    .writeU16(0)
    .writeU16(0)
    .writeU16(0)
    .writeU16(0)
    .writeU16(0)
    .writeU16(0)
    .writeI8(Math.round(snapshot.batteryPct))
    .toBytes();
}

function buildGpsRawInt(snapshot: DemoSnapshot): Uint8Array {
  return new ByteWriter(30)
    .writeU64(snapshot.timeMs * 1000)
    .writeI32(Math.round(snapshot.latDeg * 1e7))
    .writeI32(Math.round(snapshot.lonDeg * 1e7))
    .writeI32(Math.round(((DEMO_HOME.altM ?? 0) + snapshot.altRelM) * 1000))
    .writeU16(Math.round(snapshot.hdop * 100))
    .writeU16(Math.round(snapshot.hdop * 150))
    .writeU16(Math.round(snapshot.groundspeedMs * 100))
    .writeU16(Math.round(normaliseDeg(snapshot.headingDeg) * 100))
    .writeU8(snapshot.fixType)
    .writeU8(snapshot.satellites)
    .toBytes();
}

function buildMissionCurrent(snapshot: DemoSnapshot): Uint8Array {
  return new ByteWriter(2).writeU16(snapshot.currentSeq).toBytes();
}
