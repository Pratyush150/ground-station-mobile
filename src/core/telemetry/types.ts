/**
 * Typed telemetry domain model.
 *
 * Everything in `src/core` is framework-free: no React, no React Native, no
 * Expo. The UI layer imports these types, never the other way round. That
 * separation is what lets the logic be unit-tested on a laptop with nothing
 * but TypeScript installed.
 *
 * Angles are radians unless a field name ends in `Deg`. Distances are metres,
 * speeds metres per second, times milliseconds. Conversion to whatever the
 * operator wants to read happens once, at the edge, in `src/core/units`.
 */

/** Which flight stack is on the other end of the link. */
export type FlightStack = 'px4' | 'ardupilot' | 'unknown';

/** Vehicle airframe class, from the MAVLink HEARTBEAT `type` field. */
export type VehicleType =
  | 'multirotor'
  | 'fixed-wing'
  | 'vtol'
  | 'ground-rover'
  | 'unknown';

/** GPS fix quality, from GPS_RAW_INT `fix_type`. */
export enum GpsFixType {
  NoGps = 0,
  NoFix = 1,
  Fix2D = 2,
  Fix3D = 3,
  Dgps = 4,
  RtkFloat = 5,
  RtkFixed = 6,
  Static = 7,
  Ppp = 8,
}

/** Body-frame attitude and angular rates. */
export interface Attitude {
  /** Roll, radians. Positive right-wing-down. */
  rollRad: number;
  /** Pitch, radians. Positive nose-up. */
  pitchRad: number;
  /** Yaw, radians, -pi..pi, positive clockwise from north. */
  yawRad: number;
  rollRateRadS: number;
  pitchRateRadS: number;
  yawRateRadS: number;
  /** Autopilot boot time of the sample, milliseconds. */
  timeBootMs: number;
}

/** A WGS-84 point. Used for the vehicle, the home point and waypoints. */
export interface GeoPoint {
  latDeg: number;
  lonDeg: number;
  /** Altitude in metres. Datum depends on the field that carries it. */
  altM?: number;
}

/** Global position and velocity, from GLOBAL_POSITION_INT. */
export interface GlobalPosition {
  latDeg: number;
  lonDeg: number;
  /** Altitude above mean sea level, metres. */
  altAmslM: number;
  /** Altitude above the home point, metres. This is what pilots fly by. */
  altRelM: number;
  /** North/East/Down velocity, m/s. */
  vxMs: number;
  vyMs: number;
  vzMs: number;
  /** Heading in degrees, 0..360. */
  headingDeg: number;
  timeBootMs: number;
}

/** Battery state. `remainingPct` is -1 when the autopilot cannot estimate it. */
export interface Battery {
  voltageV: number;
  currentA: number;
  remainingPct: number;
  consumedMah?: number;
  cellCount?: number;
}

/** GNSS receiver state. */
export interface GpsStatus {
  fixType: GpsFixType;
  satellitesVisible: number;
  /** Horizontal dilution of precision. NaN when unknown. */
  hdop: number;
  vdop: number;
}

/** Air data / derived speeds, from VFR_HUD. */
export interface AirData {
  airspeedMs: number;
  groundspeedMs: number;
  altAmslM: number;
  climbRateMs: number;
  headingDeg: number;
  throttlePct: number;
}

/** Link health, computed by the frame parser rather than reported by the vehicle. */
export interface LinkStats {
  framesDecoded: number;
  crcErrors: number;
  /** Frames the sequence numbers say we never saw. */
  framesLost: number;
  bytesDropped: number;
  /** 0..100. Lost / (lost + decoded) over the whole session. */
  lossRatePct: number;
  /** Wall-clock time of the last successfully decoded frame. */
  lastFrameAtMs: number | null;
}

/** Decoded flight mode. `raw` is kept so an unknown mode still shows something. */
export interface FlightMode {
  stack: FlightStack;
  /** Human-readable name, e.g. "AUTO.MISSION" or "LOITER". */
  name: string;
  /** Raw custom_mode from HEARTBEAT. */
  raw: number;
  /** True when the mode is one the autopilot flies without pilot input. */
  autonomous: boolean;
}

/** Armed state plus the base_mode bits it was derived from. */
export interface ArmedState {
  armed: boolean;
  /** True when the autopilot is running a custom (stack-specific) mode. */
  customModeEnabled: boolean;
  /** True when the autopilot is in hardware-in-the-loop simulation. */
  hilEnabled: boolean;
  guidedEnabled: boolean;
  autoEnabled: boolean;
  baseMode: number;
}

/**
 * Names of the independently-aged telemetry groups.
 *
 * These are the keys the staleness tracker works over. A GCS that greys out
 * the whole screen because one stream stopped is useless; a GCS that keeps
 * showing a frozen altitude as if it were live is dangerous. Per-group ageing
 * is the middle path.
 */
export type TelemetryField =
  | 'attitude'
  | 'position'
  | 'battery'
  | 'gps'
  | 'airData'
  | 'heartbeat'
  | 'missionCurrent';

/** The complete vehicle picture the UI renders. */
export interface VehicleState {
  stack: FlightStack;
  vehicleType: VehicleType;
  attitude: Attitude | null;
  position: GlobalPosition | null;
  battery: Battery | null;
  gps: GpsStatus | null;
  airData: AirData | null;
  mode: FlightMode | null;
  armedState: ArmedState | null;
  /** Set from the first valid position fix after arming, or from the vehicle. */
  home: GeoPoint | null;
  /** Sequence number of the mission item the vehicle is currently flying to. */
  currentWaypointSeq: number | null;
  link: LinkStats;
  /** Wall-clock milliseconds of the most recent update to any field. */
  updatedAtMs: number;
}
