/**
 * Mission model.
 *
 * A mission is the list of items the autopilot is flying. This module holds
 * only the subset a monitoring app needs: enough to draw the path, say which
 * item is next, and tell the operator how far there is left to go. Uploading
 * and editing missions is deliberately out of scope (see the README).
 */

/** MAV_CMD values that appear in a mission list. */
export enum MavCmd {
  NavWaypoint = 16,
  NavLoiterUnlimited = 17,
  NavLoiterTurns = 18,
  NavLoiterTime = 19,
  NavReturnToLaunch = 20,
  NavLand = 21,
  NavTakeoff = 22,
  NavVtolTakeoff = 84,
  NavVtolLand = 85,
  DoJump = 177,
  DoChangeSpeed = 178,
  DoSetServo = 183,
  DoDigicamControl = 203,
  DoMountControl = 205,
}

/** MAV_FRAME values a mission item can be expressed in. */
export enum MavFrame {
  Global = 0,
  LocalNed = 1,
  Mission = 2,
  GlobalRelativeAlt = 3,
  GlobalInt = 5,
  GlobalRelativeAltInt = 6,
  GlobalTerrainAlt = 10,
  GlobalTerrainAltInt = 11,
}

/** One mission item. Matches MISSION_ITEM_INT field-for-field. */
export interface MissionItem {
  seq: number;
  command: MavCmd | number;
  frame: MavFrame | number;
  latDeg: number;
  lonDeg: number;
  /** Altitude, in the datum implied by `frame`. */
  altM: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  autocontinue: boolean;
}

/** A mission plus the home point it is flown relative to. */
export interface Mission {
  items: MissionItem[];
  home: { latDeg: number; lonDeg: number; altM: number } | null;
  /** Free-text name, for the mission list screen. */
  name?: string;
}

/** Commands that carry a real lat/lon and therefore move the aircraft. */
const NAVIGATION_COMMANDS = new Set<number>([
  MavCmd.NavWaypoint,
  MavCmd.NavLoiterUnlimited,
  MavCmd.NavLoiterTurns,
  MavCmd.NavLoiterTime,
  MavCmd.NavLand,
  MavCmd.NavTakeoff,
  MavCmd.NavVtolTakeoff,
  MavCmd.NavVtolLand,
]);

/** True when the item has coordinates worth drawing on the map. */
export function isNavigationItem(item: MissionItem): boolean {
  if (!NAVIGATION_COMMANDS.has(item.command)) return false;
  // A takeoff item is often uploaded with 0/0 coordinates, meaning "here".
  return item.latDeg !== 0 || item.lonDeg !== 0;
}

/** Short label for a command, for the waypoint list. */
export function commandLabel(command: number): string {
  switch (command) {
    case MavCmd.NavWaypoint:
      return 'WAYPOINT';
    case MavCmd.NavLoiterUnlimited:
      return 'LOITER';
    case MavCmd.NavLoiterTurns:
      return 'LOITER TURNS';
    case MavCmd.NavLoiterTime:
      return 'LOITER TIME';
    case MavCmd.NavReturnToLaunch:
      return 'RTL';
    case MavCmd.NavLand:
      return 'LAND';
    case MavCmd.NavTakeoff:
      return 'TAKEOFF';
    case MavCmd.NavVtolTakeoff:
      return 'VTOL TAKEOFF';
    case MavCmd.NavVtolLand:
      return 'VTOL LAND';
    case MavCmd.DoJump:
      return 'JUMP';
    case MavCmd.DoChangeSpeed:
      return 'CHANGE SPEED';
    default:
      return `CMD ${command}`;
  }
}

/** Convenience constructor so callers do not repeat the unused params. */
export function waypoint(
  seq: number,
  latDeg: number,
  lonDeg: number,
  altM: number,
  overrides: Partial<MissionItem> = {},
): MissionItem {
  return {
    seq,
    command: MavCmd.NavWaypoint,
    frame: MavFrame.GlobalRelativeAltInt,
    latDeg,
    lonDeg,
    altM,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    autocontinue: true,
    ...overrides,
  };
}
