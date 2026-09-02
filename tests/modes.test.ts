import { describe, expect, it } from 'vitest';

import {
  BaseModeFlag,
  autopilotToStack,
  decodeArduPilotMode,
  decodeArmedState,
  decodeFlightMode,
  decodePx4Mode,
  encodePx4Mode,
  mavTypeToVehicleType,
} from '../src/core/telemetry/modes';

describe('PX4 custom_mode decoding', () => {
  it('decodes main modes from bits 16-23', () => {
    expect(decodePx4Mode(encodePx4Mode(1))).toBe('MANUAL');
    expect(decodePx4Mode(encodePx4Mode(3))).toBe('POSCTL');
    expect(decodePx4Mode(encodePx4Mode(6))).toBe('OFFBOARD');
  });

  it('decodes AUTO sub-modes from bits 24-31', () => {
    expect(decodePx4Mode(encodePx4Mode(4, 2))).toBe('AUTO.TAKEOFF');
    expect(decodePx4Mode(encodePx4Mode(4, 4))).toBe('AUTO.MISSION');
    expect(decodePx4Mode(encodePx4Mode(4, 5))).toBe('AUTO.RTL');
    expect(decodePx4Mode(encodePx4Mode(4, 6))).toBe('AUTO.LAND');
  });

  it('packs the mode word the way PX4 does', () => {
    // main mode 4 in bits 16-23, sub mode 4 in bits 24-31.
    expect(encodePx4Mode(4, 4)).toBe(0x04040000);
  });

  it('reports an unknown main mode rather than guessing', () => {
    expect(decodePx4Mode(encodePx4Mode(99))).toMatch(/^UNKNOWN\(/);
  });
});

describe('ArduPilot mode decoding', () => {
  it('decodes copter modes', () => {
    expect(decodeArduPilotMode(0, 'multirotor')).toBe('STABILIZE');
    expect(decodeArduPilotMode(3, 'multirotor')).toBe('AUTO');
    expect(decodeArduPilotMode(5, 'multirotor')).toBe('LOITER');
    expect(decodeArduPilotMode(6, 'multirotor')).toBe('RTL');
    expect(decodeArduPilotMode(9, 'multirotor')).toBe('LAND');
  });

  it('uses the plane table for fixed-wing and VTOL airframes', () => {
    // Mode number 10 is AUTO on plane and unassigned on copter.
    expect(decodeArduPilotMode(10, 'fixed-wing')).toBe('AUTO');
    expect(decodeArduPilotMode(21, 'vtol')).toBe('QRTL');
    expect(decodeArduPilotMode(10, 'multirotor')).toMatch(/^UNKNOWN\(/);
  });
});

describe('heartbeat interpretation', () => {
  it('maps autopilot and vehicle type identifiers', () => {
    expect(autopilotToStack(12)).toBe('px4');
    expect(autopilotToStack(3)).toBe('ardupilot');
    expect(autopilotToStack(0)).toBe('unknown');
    expect(mavTypeToVehicleType(2)).toBe('multirotor');
    expect(mavTypeToVehicleType(1)).toBe('fixed-wing');
    expect(mavTypeToVehicleType(20)).toBe('vtol');
  });

  it('decodes armed state from the base_mode bits', () => {
    const armed = decodeArmedState(BaseModeFlag.SafetyArmed | BaseModeFlag.CustomModeEnabled);
    expect(armed.armed).toBe(true);
    expect(armed.customModeEnabled).toBe(true);
    expect(armed.hilEnabled).toBe(false);

    const disarmed = decodeArmedState(BaseModeFlag.CustomModeEnabled);
    expect(disarmed.armed).toBe(false);
  });

  it('falls back to base_mode when custom modes are not enabled', () => {
    const mode = decodeFlightMode({
      stack: 'px4',
      vehicleType: 'multirotor',
      customMode: encodePx4Mode(4, 4),
      baseMode: BaseModeFlag.AutoEnabled,
    });
    expect(mode.name).toBe('AUTO');
    expect(mode.autonomous).toBe(true);
  });

  it('marks pilot-flown modes as not autonomous', () => {
    const mode = decodeFlightMode({
      stack: 'px4',
      vehicleType: 'multirotor',
      customMode: encodePx4Mode(3),
      baseMode: BaseModeFlag.CustomModeEnabled | BaseModeFlag.SafetyArmed,
    });
    expect(mode.name).toBe('POSCTL');
    expect(mode.autonomous).toBe(false);
  });
});
