import { describe, expect, it } from 'vitest';

import { destinationPoint } from '../src/core/geo';
import {
  MavCmd,
  MavFrame,
  Mission,
  commandLabel,
  computeProgress,
  isNavigationItem,
  missionIsFlyable,
  missionLegs,
  totalMissionDistanceM,
  validateMission,
  waypoint,
} from '../src/core/mission';

const HOME = { latDeg: 47.397742, lonDeg: 8.545594, altM: 488 };
const WP1 = destinationPoint(HOME, 0, 200); // 200 m north
const WP2 = destinationPoint(WP1, 90, 200); // then 200 m east

function buildMission(): Mission {
  return {
    name: 'Test box',
    home: HOME,
    items: [
      {
        seq: 0,
        command: MavCmd.NavTakeoff,
        frame: MavFrame.GlobalRelativeAltInt,
        latDeg: HOME.latDeg,
        lonDeg: HOME.lonDeg,
        altM: 30,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        autocontinue: true,
      },
      waypoint(1, WP1.latDeg, WP1.lonDeg, 30),
      waypoint(2, WP2.latDeg, WP2.lonDeg, 30),
      {
        seq: 3,
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
      },
    ],
  };
}

describe('mission model', () => {
  it('counts only items that carry real coordinates as navigation items', () => {
    const mission = buildMission();
    expect(mission.items.filter(isNavigationItem)).toHaveLength(3);
    expect(isNavigationItem(mission.items[3])).toBe(false);
  });

  it('builds legs between consecutive navigation items', () => {
    const legs = missionLegs(buildMission());
    expect(legs).toHaveLength(2);
    expect(legs[0].distanceM).toBeCloseTo(200, 3);
    expect(legs[0].bearingDeg).toBeCloseTo(0, 3);
    expect(legs[1].distanceM).toBeCloseTo(200, 3);
    expect(totalMissionDistanceM(buildMission())).toBeCloseTo(400, 3);
  });

  it('labels commands for the waypoint list', () => {
    expect(commandLabel(MavCmd.NavTakeoff)).toBe('TAKEOFF');
    expect(commandLabel(MavCmd.NavReturnToLaunch)).toBe('RTL');
    expect(commandLabel(9999)).toBe('CMD 9999');
  });
});

describe('mission progress', () => {
  it('computes distance remaining along the path and the ETA from groundspeed', () => {
    const mission = buildMission();
    const vehicle = destinationPoint(HOME, 0, 150); // 50 m short of waypoint 1
    const progress = computeProgress({
      mission,
      currentSeq: 1,
      vehicle,
      groundspeedMs: 10,
    });

    expect(progress.nextItem?.seq).toBe(1);
    expect(progress.distanceToNextM).toBeCloseTo(50, 2);
    expect(progress.distanceRemainingM).toBeCloseTo(250, 2);
    expect(progress.etaToNextSeconds).toBeCloseTo(5, 3);
    expect(progress.etaTotalSeconds).toBeCloseTo(25, 3);
    expect(progress.completedFraction).toBeCloseTo(0.375, 4);
    expect(progress.itemsRemaining).toBe(2);
  });

  it('refuses to give an ETA while effectively stationary', () => {
    const progress = computeProgress({
      mission: buildMission(),
      currentSeq: 1,
      vehicle: HOME,
      groundspeedMs: 0.2,
    });
    expect(progress.etaTotalSeconds).toBeNull();
    expect(progress.etaToNextSeconds).toBeNull();
    expect(progress.distanceRemainingM).toBeGreaterThan(0);
  });

  it('skips to the next navigation item when the current one is a DO_ command', () => {
    const mission = buildMission();
    mission.items.push({
      seq: 4,
      command: MavCmd.DoChangeSpeed,
      frame: MavFrame.Mission,
      latDeg: 0,
      lonDeg: 0,
      altM: 0,
      param1: 0,
      param2: 12,
      param3: 0,
      param4: 0,
      autocontinue: true,
    });
    const progress = computeProgress({
      mission,
      currentSeq: 2,
      vehicle: HOME,
      groundspeedMs: 12,
    });
    expect(progress.nextItem?.seq).toBe(2);
  });

  it('reports a finished mission once the sequence runs past the last item', () => {
    const progress = computeProgress({
      mission: buildMission(),
      currentSeq: 9,
      vehicle: HOME,
      groundspeedMs: 12,
    });
    expect(progress.nextItem).toBeNull();
    expect(progress.completedFraction).toBe(1);
    expect(progress.itemsRemaining).toBe(0);
  });

  it('has no progress at all before MISSION_CURRENT has arrived', () => {
    const progress = computeProgress({
      mission: buildMission(),
      currentSeq: null,
      vehicle: HOME,
      groundspeedMs: 12,
    });
    expect(progress.completedFraction).toBe(0);
    expect(progress.nextItem).toBeNull();
  });
});

describe('mission validation', () => {
  it('accepts a well-formed mission with no errors', () => {
    const issues = validateMission(buildMission());
    expect(missionIsFlyable(issues)).toBe(true);
    expect(issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  it('rejects an empty mission', () => {
    const issues = validateMission({ items: [], home: HOME });
    expect(issues.map((issue) => issue.code)).toContain('empty-mission');
    expect(missionIsFlyable(issues)).toBe(false);
  });

  it('catches the empty-spreadsheet-cell waypoint at 0, 0', () => {
    const mission = buildMission();
    mission.items[1] = waypoint(1, 0, 0, 30);
    const issues = validateMission(mission);
    expect(issues.map((issue) => issue.code)).toContain('null-island');
    expect(missionIsFlyable(issues)).toBe(false);
  });

  it('catches out-of-range and non-finite coordinates', () => {
    const mission = buildMission();
    mission.items[1] = waypoint(1, 91, 8.5, 30);
    mission.items[2] = waypoint(2, Number.NaN, 8.5, 30);
    const codes = validateMission(mission).map((issue) => issue.code);
    expect(codes).toContain('latitude-out-of-range');
    expect(codes).toContain('non-finite-coordinate');
  });

  it('warns about a leg long enough to be a typo', () => {
    const mission = buildMission();
    mission.items[2] = waypoint(2, HOME.latDeg + 0.5, HOME.lonDeg, 30);
    const issues = validateMission(mission);
    const longLeg = issues.find((issue) => issue.code === 'long-leg');
    expect(longLeg?.severity).toBe('warning');
    expect(missionIsFlyable(issues)).toBe(true);
  });

  it('warns when a mission has no takeoff or no terminal item', () => {
    const mission = buildMission();
    mission.items = [waypoint(0, WP1.latDeg, WP1.lonDeg, 30), waypoint(1, WP2.latDeg, WP2.lonDeg, 30)];
    const codes = validateMission(mission).map((issue) => issue.code);
    expect(codes).toContain('no-takeoff');
    expect(codes).toContain('no-terminal-item');
  });

  it('warns when there is no home position to measure against', () => {
    const mission = { ...buildMission(), home: null };
    expect(validateMission(mission).map((issue) => issue.code)).toContain('no-home');
  });

  it('reports errors before warnings', () => {
    const mission = buildMission();
    mission.items[1] = waypoint(1, 0, 0, 30);
    mission.items.push(waypoint(4, WP2.latDeg + 0.5, WP2.lonDeg, 30));
    const issues = validateMission(mission);
    expect(issues[0].severity).toBe('error');
  });
});
