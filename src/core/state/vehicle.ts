/**
 * Vehicle state assembly.
 *
 * Decoded messages arrive one at a time, out of order, at different rates.
 * This module folds them into one `VehicleState` and records when each group
 * last changed, so the UI can render both the value and its age.
 *
 * It is a plain reducer: no React, no observables. The hook in `src/hooks`
 * wraps it, and the tests drive it directly.
 */

import { DecodedMessage } from '../telemetry/decode';
import {
  autopilotToStack,
  decodeArmedState,
  decodeFlightMode,
  mavTypeToVehicleType,
} from '../telemetry/modes';
import { DEFAULT_MAX_AGE_MS, StalenessTracker } from '../telemetry/staleness';
import {
  GeoPoint,
  GpsFixType,
  LinkStats,
  TelemetryField,
  VehicleState,
} from '../telemetry/types';

/** Telemetry groups the flight display depends on. */
export const CRITICAL_FIELDS: readonly TelemetryField[] = [
  'attitude',
  'position',
  'battery',
  'heartbeat',
];

export function emptyLinkStats(): LinkStats {
  return {
    framesDecoded: 0,
    crcErrors: 0,
    framesLost: 0,
    bytesDropped: 0,
    lossRatePct: 0,
    lastFrameAtMs: null,
  };
}

/** A vehicle we have not heard from yet. */
export function createVehicleState(): VehicleState {
  return {
    stack: 'unknown',
    vehicleType: 'unknown',
    attitude: null,
    position: null,
    battery: null,
    gps: null,
    airData: null,
    mode: null,
    armedState: null,
    home: null,
    currentWaypointSeq: null,
    link: emptyLinkStats(),
    updatedAtMs: 0,
  };
}

/**
 * Holds the vehicle state and the age of every field.
 *
 * Kept as a small class rather than a free function because the staleness
 * tracker is inherently stateful, and threading it through a pure reducer
 * made every call site carry a second value for no benefit.
 */
export class VehicleStateStore {
  private state: VehicleState = createVehicleState();

  readonly freshness = new StalenessTracker<TelemetryField>(DEFAULT_MAX_AGE_MS);

  /** Current snapshot. Replaced, never mutated, so React can compare by identity. */
  get current(): VehicleState {
    return this.state;
  }

  /** Reset everything. Call on disconnect. */
  reset(): void {
    this.state = createVehicleState();
    this.lastFramesDecoded = 0;
    this.freshness.reset();
  }

  /** Set the home point manually, e.g. "use my phone's position as home". */
  setHome(home: GeoPoint | null): void {
    this.state = { ...this.state, home };
  }

  private lastFramesDecoded = 0;

  /**
   * Fold in the parser's counters.
   *
   * `lastFrameAtMs` only moves when the decoded-frame count has actually
   * increased. Setting it on every call - the obvious version - makes the link
   * look alive for as long as the app keeps polling, which defeats the whole
   * point of the link-loss alert.
   */
  applyLinkStats(
    stats: { framesDecoded: number; crcErrors: number; framesLost: number; bytesDropped: number },
    nowMs: number,
  ): VehicleState {
    const total = stats.framesDecoded + stats.framesLost;
    const sawNewFrames = stats.framesDecoded > this.lastFramesDecoded;
    this.lastFramesDecoded = stats.framesDecoded;
    this.state = {
      ...this.state,
      link: {
        ...stats,
        lossRatePct: total === 0 ? 0 : (stats.framesLost / total) * 100,
        lastFrameAtMs: sawNewFrames ? nowMs : this.state.link.lastFrameAtMs,
      },
    };
    return this.state;
  }

  /** Fold one decoded message into the state. */
  apply(message: DecodedMessage, nowMs: number): VehicleState {
    const previous = this.state;
    let next = previous;

    switch (message.type) {
      case 'heartbeat': {
        const stack = autopilotToStack(message.autopilotRaw);
        const vehicleType = mavTypeToVehicleType(message.vehicleTypeRaw);
        next = {
          ...previous,
          stack,
          vehicleType,
          mode: decodeFlightMode({
            stack,
            vehicleType,
            customMode: message.customMode,
            baseMode: message.baseMode,
          }),
          armedState: decodeArmedState(message.baseMode),
        };
        this.freshness.mark('heartbeat', nowMs);
        break;
      }

      case 'attitude': {
        next = {
          ...previous,
          attitude: {
            rollRad: message.rollRad,
            pitchRad: message.pitchRad,
            yawRad: message.yawRad,
            rollRateRadS: message.rollRateRadS,
            pitchRateRadS: message.pitchRateRadS,
            yawRateRadS: message.yawRateRadS,
            timeBootMs: message.timeBootMs,
          },
        };
        this.freshness.mark('attitude', nowMs);
        break;
      }

      case 'global_position_int': {
        const position = {
          latDeg: message.latDeg,
          lonDeg: message.lonDeg,
          altAmslM: message.altAmslM,
          altRelM: message.altRelM,
          vxMs: message.vxMs,
          vyMs: message.vyMs,
          vzMs: message.vzMs,
          headingDeg: message.headingDeg,
          timeBootMs: message.timeBootMs,
        };
        // The first fix received while armed is a workable home point when the
        // vehicle has not sent HOME_POSITION. It is replaced by an explicit
        // home the moment one arrives.
        const home =
          previous.home ??
          (previous.armedState?.armed === true
            ? { latDeg: message.latDeg, lonDeg: message.lonDeg, altM: message.altAmslM }
            : null);
        next = { ...previous, position, home };
        this.freshness.mark('position', nowMs);
        break;
      }

      case 'gps_raw_int': {
        next = {
          ...previous,
          gps: {
            fixType: message.fixType as GpsFixType,
            satellitesVisible: message.satellitesVisible,
            hdop: message.hdop,
            vdop: message.vdop,
          },
        };
        this.freshness.mark('gps', nowMs);
        break;
      }

      case 'sys_status': {
        next = {
          ...previous,
          battery: {
            voltageV: message.voltageV,
            currentA: message.currentA,
            remainingPct: message.remainingPct,
            consumedMah: previous.battery?.consumedMah,
            cellCount: previous.battery?.cellCount,
          },
        };
        this.freshness.mark('battery', nowMs);
        break;
      }

      case 'battery_status': {
        next = {
          ...previous,
          battery: {
            voltageV: message.voltageV,
            currentA: message.currentA,
            remainingPct: message.remainingPct,
            consumedMah: message.consumedMah,
            cellCount: message.cellCount,
          },
        };
        this.freshness.mark('battery', nowMs);
        break;
      }

      case 'vfr_hud': {
        next = {
          ...previous,
          airData: {
            airspeedMs: message.airspeedMs,
            groundspeedMs: message.groundspeedMs,
            altAmslM: message.altAmslM,
            climbRateMs: message.climbRateMs,
            headingDeg: message.headingDeg,
            throttlePct: message.throttlePct,
          },
        };
        this.freshness.mark('airData', nowMs);
        break;
      }

      case 'mission_current':
      case 'mission_item_reached': {
        next = { ...previous, currentWaypointSeq: message.seq };
        this.freshness.mark('missionCurrent', nowMs);
        break;
      }

      case 'statustext':
        // Status text is surfaced by the alert feed, not the vehicle state.
        return previous;

      default:
        return previous;
    }

    next = { ...next, updatedAtMs: nowMs };
    this.state = next;
    return next;
  }

  /** Groups whose data is too old to display as live. */
  staleFields(nowMs: number, fields: readonly TelemetryField[] = CRITICAL_FIELDS): TelemetryField[] {
    return this.freshness.staleFields(nowMs, fields);
  }

  /** Groundspeed from whichever source is available, or null. */
  groundspeedMs(): number | null {
    if (this.state.airData !== null && Number.isFinite(this.state.airData.groundspeedMs)) {
      return this.state.airData.groundspeedMs;
    }
    const position = this.state.position;
    if (position === null) return null;
    return Math.hypot(position.vxMs, position.vyMs);
  }

  /** Vehicle position as a plain geo point, using altitude above home. */
  positionPoint(): GeoPoint | null {
    const position = this.state.position;
    if (position === null) return null;
    return { latDeg: position.latDeg, lonDeg: position.lonDeg, altM: position.altRelM };
  }
}
