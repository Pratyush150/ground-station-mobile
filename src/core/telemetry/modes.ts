/**
 * Flight-mode and armed-state decoding for PX4 and ArduPilot.
 *
 * Both stacks send a HEARTBEAT with a 32-bit `custom_mode`, and both pack it
 * differently. Getting this wrong means the screen says LOITER while the
 * aircraft is flying a mission, which is the kind of mistake an operator only
 * notices after it matters.
 *
 * PX4 packs main mode in bits 16-23 and sub mode in bits 24-31.
 * ArduPilot uses the whole value as a flat mode number, per vehicle class.
 */

import { ArmedState, FlightMode, FlightStack, VehicleType } from './types';

/** MAV_MODE_FLAG bits from the HEARTBEAT `base_mode` field. */
export enum BaseModeFlag {
  CustomModeEnabled = 1,
  TestEnabled = 2,
  AutoEnabled = 4,
  GuidedEnabled = 8,
  StabilizeEnabled = 16,
  HilEnabled = 32,
  ManualInputEnabled = 64,
  SafetyArmed = 128,
}

/** PX4 main modes (upper byte of the 16-bit mode word). */
const PX4_MAIN_MODE: Readonly<Record<number, string>> = {
  1: 'MANUAL',
  2: 'ALTCTL',
  3: 'POSCTL',
  4: 'AUTO',
  5: 'ACRO',
  6: 'OFFBOARD',
  7: 'STABILIZED',
  8: 'RATTITUDE',
  9: 'SIMPLE',
  10: 'TERMINATION',
};

/** PX4 AUTO sub-modes. Only meaningful when main mode is AUTO. */
const PX4_AUTO_SUB_MODE: Readonly<Record<number, string>> = {
  1: 'READY',
  2: 'TAKEOFF',
  3: 'LOITER',
  4: 'MISSION',
  5: 'RTL',
  6: 'LAND',
  7: 'RTGS',
  8: 'FOLLOW_TARGET',
  9: 'PRECLAND',
};

/** ArduPilot copter mode numbers. */
const ARDUCOPTER_MODE: Readonly<Record<number, string>> = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  5: 'LOITER',
  6: 'RTL',
  7: 'CIRCLE',
  9: 'LAND',
  11: 'DRIFT',
  13: 'SPORT',
  14: 'FLIP',
  15: 'AUTOTUNE',
  16: 'POSHOLD',
  17: 'BRAKE',
  18: 'THROW',
  19: 'AVOID_ADSB',
  20: 'GUIDED_NOGPS',
  21: 'SMART_RTL',
  22: 'FLOWHOLD',
  23: 'FOLLOW',
  24: 'ZIGZAG',
  25: 'SYSTEMID',
  26: 'AUTOROTATE',
  27: 'AUTO_RTL',
};

/** ArduPilot plane mode numbers, for fixed-wing and VTOL airframes. */
const ARDUPLANE_MODE: Readonly<Record<number, string>> = {
  0: 'MANUAL',
  1: 'CIRCLE',
  2: 'STABILIZE',
  3: 'TRAINING',
  4: 'ACRO',
  5: 'FBWA',
  6: 'FBWB',
  7: 'CRUISE',
  8: 'AUTOTUNE',
  10: 'AUTO',
  11: 'RTL',
  12: 'LOITER',
  13: 'TAKEOFF',
  14: 'AVOID_ADSB',
  15: 'GUIDED',
  17: 'QSTABILIZE',
  18: 'QHOVER',
  19: 'QLOITER',
  20: 'QLAND',
  21: 'QRTL',
  22: 'QAUTOTUNE',
  23: 'QACRO',
  24: 'THERMAL',
  25: 'LOITER_ALT_QLAND',
};

/** Modes in which the autopilot flies the aircraft without stick input. */
const AUTONOMOUS_NAMES = new Set([
  'AUTO',
  'AUTO.MISSION',
  'AUTO.RTL',
  'AUTO.LAND',
  'AUTO.TAKEOFF',
  'AUTO.LOITER',
  'AUTO.READY',
  'AUTO.PRECLAND',
  'AUTO.FOLLOW_TARGET',
  'AUTO.RTGS',
  'OFFBOARD',
  'GUIDED',
  'GUIDED_NOGPS',
  'RTL',
  'SMART_RTL',
  'AUTO_RTL',
  'LAND',
  'QLAND',
  'QRTL',
  'TAKEOFF',
]);

/** MAV_AUTOPILOT value to our stack identifier. */
export function autopilotToStack(autopilot: number): FlightStack {
  if (autopilot === 12) return 'px4';
  if (autopilot === 3) return 'ardupilot';
  return 'unknown';
}

/** MAV_TYPE value to a coarse airframe class. */
export function mavTypeToVehicleType(mavType: number): VehicleType {
  switch (mavType) {
    case 2: // quadrotor
    case 3: // coaxial
    case 4: // helicopter
    case 13: // hexarotor
    case 14: // octorotor
    case 15: // tricopter
      return 'multirotor';
    case 1: // fixed wing
      return 'fixed-wing';
    case 19: // VTOL tailsitter duorotor
    case 20: // VTOL tailsitter quadrotor
    case 21: // VTOL tiltrotor
    case 22:
    case 23:
    case 24:
    case 25:
      return 'vtol';
    case 10: // ground rover
    case 11: // surface boat
      return 'ground-rover';
    default:
      return 'unknown';
  }
}

/** Decode the PX4 `custom_mode` word into "MAIN" or "AUTO.SUB". */
export function decodePx4Mode(customMode: number): string {
  const mainMode = (customMode >>> 16) & 0xff;
  const subMode = (customMode >>> 24) & 0xff;
  const mainName = PX4_MAIN_MODE[mainMode];
  if (mainName === undefined) return `UNKNOWN(${customMode})`;
  if (mainName !== 'AUTO') return mainName;
  const subName = PX4_AUTO_SUB_MODE[subMode];
  return subName === undefined ? 'AUTO' : `AUTO.${subName}`;
}

/** Build a PX4 `custom_mode` word. The inverse of {@link decodePx4Mode}. */
export function encodePx4Mode(mainMode: number, subMode = 0): number {
  return (((subMode & 0xff) << 24) | ((mainMode & 0xff) << 16)) >>> 0;
}

/** Decode an ArduPilot mode number for the given airframe class. */
export function decodeArduPilotMode(customMode: number, vehicleType: VehicleType): string {
  const table =
    vehicleType === 'fixed-wing' || vehicleType === 'vtol' ? ARDUPLANE_MODE : ARDUCOPTER_MODE;
  return table[customMode] ?? `UNKNOWN(${customMode})`;
}

/**
 * Decode a HEARTBEAT into a display mode.
 *
 * `base_mode` bit 0 tells us whether `custom_mode` means anything at all. If
 * it is clear, the autopilot is in a generic MAVLink mode and we fall back to
 * the base-mode bits rather than inventing a name.
 */
export function decodeFlightMode(options: {
  stack: FlightStack;
  vehicleType: VehicleType;
  customMode: number;
  baseMode: number;
}): FlightMode {
  const { stack, vehicleType, customMode, baseMode } = options;
  const customEnabled = (baseMode & BaseModeFlag.CustomModeEnabled) !== 0;

  let name: string;
  if (!customEnabled) {
    if (baseMode & BaseModeFlag.AutoEnabled) name = 'AUTO';
    else if (baseMode & BaseModeFlag.GuidedEnabled) name = 'GUIDED';
    else if (baseMode & BaseModeFlag.StabilizeEnabled) name = 'STABILIZE';
    else if (baseMode & BaseModeFlag.ManualInputEnabled) name = 'MANUAL';
    else name = 'UNKNOWN';
  } else if (stack === 'px4') {
    name = decodePx4Mode(customMode);
  } else if (stack === 'ardupilot') {
    name = decodeArduPilotMode(customMode, vehicleType);
  } else {
    name = `CUSTOM(${customMode})`;
  }

  return { stack, name, raw: customMode, autonomous: AUTONOMOUS_NAMES.has(name) };
}

/** Decode the armed and capability bits out of `base_mode`. */
export function decodeArmedState(baseMode: number): ArmedState {
  return {
    armed: (baseMode & BaseModeFlag.SafetyArmed) !== 0,
    customModeEnabled: (baseMode & BaseModeFlag.CustomModeEnabled) !== 0,
    hilEnabled: (baseMode & BaseModeFlag.HilEnabled) !== 0,
    guidedEnabled: (baseMode & BaseModeFlag.GuidedEnabled) !== 0,
    autoEnabled: (baseMode & BaseModeFlag.AutoEnabled) !== 0,
    baseMode,
  };
}

/** MAV_STATE to a short label for the status bar. */
export function decodeSystemStatus(systemStatus: number): string {
  const names = [
    'UNINIT',
    'BOOT',
    'CALIBRATING',
    'STANDBY',
    'ACTIVE',
    'CRITICAL',
    'EMERGENCY',
    'POWEROFF',
    'TERMINATION',
  ];
  return names[systemStatus] ?? `STATE(${systemStatus})`;
}
