/**
 * Mission validation.
 *
 * Run before flight, on a mission downloaded from the vehicle. The point is
 * not to re-implement the autopilot's own checks; it is to surface the things
 * that are legal to upload and still ruin a flight: a waypoint at 0/0 because
 * a spreadsheet column was empty, a 40 km leg from a typo'd longitude, a
 * mission with no landing item on an aircraft that cannot hover.
 */

import { haversineDistanceM } from '../geo/distance';
import { Mission, MavCmd, MissionItem, isNavigationItem } from './types';

export type IssueSeverity = 'error' | 'warning';

export interface MissionIssue {
  severity: IssueSeverity;
  /** Stable machine-readable code, for tests and for filtering in the UI. */
  code: string;
  message: string;
  /** Sequence number the issue relates to, if any. */
  seq: number | null;
}

/** Legs longer than this are flagged. Typical small-UAV missions stay well under. */
export const LONG_LEG_WARNING_M = 5000;
/** Waypoints closer together than this are usually a duplicated row. */
export const DUPLICATE_POINT_M = 1;

/** Check a mission and return every problem found, worst first. */
export function validateMission(mission: Mission): MissionIssue[] {
  const issues: MissionIssue[] = [];
  const push = (severity: IssueSeverity, code: string, message: string, seq: number | null) =>
    issues.push({ severity, code, message, seq });

  if (mission.items.length === 0) {
    push('error', 'empty-mission', 'Mission has no items.', null);
    return issues;
  }

  const sorted = [...mission.items].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i];

    if (!Number.isFinite(item.latDeg) || !Number.isFinite(item.lonDeg)) {
      push('error', 'non-finite-coordinate', `Item ${item.seq} has a non-finite coordinate.`, item.seq);
      continue;
    }
    if (item.latDeg < -90 || item.latDeg > 90) {
      push('error', 'latitude-out-of-range', `Item ${item.seq} latitude ${item.latDeg} is out of range.`, item.seq);
    }
    if (item.lonDeg < -180 || item.lonDeg > 180) {
      push('error', 'longitude-out-of-range', `Item ${item.seq} longitude ${item.lonDeg} is out of range.`, item.seq);
    }
    if (isNavigationItem(item) && !Number.isFinite(item.altM)) {
      push('error', 'non-finite-altitude', `Item ${item.seq} has a non-finite altitude.`, item.seq);
    }
    if (isNavigationItem(item) && item.altM < 0) {
      push('warning', 'negative-altitude', `Item ${item.seq} altitude is below the home point.`, item.seq);
    }
  }

  // Zero coordinates on a navigation command mean the null island, which is
  // almost never intended and is the classic empty-spreadsheet-cell failure.
  for (const item of sorted) {
    const navCommand = item.command === MavCmd.NavWaypoint || item.command === MavCmd.NavLoiterUnlimited;
    if (navCommand && item.latDeg === 0 && item.lonDeg === 0) {
      push('error', 'null-island', `Item ${item.seq} is at 0.0, 0.0.`, item.seq);
    }
  }

  const seqs = sorted.map((item) => item.seq);
  if (new Set(seqs).size !== seqs.length) {
    push('error', 'duplicate-seq', 'Two mission items share a sequence number.', null);
  }

  const navItems = sorted.filter(isNavigationItem);
  if (navItems.length === 0) {
    push('error', 'no-navigation-items', 'Mission has no items with coordinates.', null);
    return sortIssues(issues);
  }

  for (let i = 0; i < navItems.length - 1; i += 1) {
    const a = navItems[i];
    const b = navItems[i + 1];
    const distance = haversineDistanceM(pointOf(a), pointOf(b));
    if (distance > LONG_LEG_WARNING_M) {
      push(
        'warning',
        'long-leg',
        `Leg ${a.seq} to ${b.seq} is ${Math.round(distance)} m.`,
        b.seq,
      );
    }
    if (distance < DUPLICATE_POINT_M) {
      push('warning', 'duplicate-point', `Items ${a.seq} and ${b.seq} are at the same place.`, b.seq);
    }
  }

  const commands = sorted.map((item) => item.command);
  const hasTakeoff = commands.includes(MavCmd.NavTakeoff) || commands.includes(MavCmd.NavVtolTakeoff);
  if (!hasTakeoff) {
    push('warning', 'no-takeoff', 'Mission does not start with a takeoff item.', sorted[0].seq);
  }
  const last = sorted[sorted.length - 1];
  const endsSafely =
    last.command === MavCmd.NavLand ||
    last.command === MavCmd.NavVtolLand ||
    last.command === MavCmd.NavReturnToLaunch ||
    last.command === MavCmd.NavLoiterUnlimited;
  if (!endsSafely) {
    push(
      'warning',
      'no-terminal-item',
      'Mission does not end with land, RTL or loiter. The vehicle will do whatever its failsafe says.',
      last.seq,
    );
  }

  if (mission.home !== null) {
    const distanceHome = haversineDistanceM(mission.home, pointOf(navItems[0]));
    if (distanceHome > LONG_LEG_WARNING_M) {
      push(
        'warning',
        'far-from-home',
        `First waypoint is ${Math.round(distanceHome)} m from home.`,
        navItems[0].seq,
      );
    }
  } else {
    push('warning', 'no-home', 'No home position: distance-to-home and RTL path are unknown.', null);
  }

  return sortIssues(issues);
}

function pointOf(item: MissionItem) {
  return { latDeg: item.latDeg, lonDeg: item.lonDeg, altM: item.altM };
}

function sortIssues(issues: MissionIssue[]): MissionIssue[] {
  const rank = (severity: IssueSeverity) => (severity === 'error' ? 0 : 1);
  return [...issues].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** True when nothing worse than a warning was found. */
export function missionIsFlyable(issues: readonly MissionIssue[]): boolean {
  return !issues.some((issue) => issue.severity === 'error');
}
