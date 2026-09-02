/**
 * Mission progress: what is next, how far is left, and when it lands.
 *
 * The distance-remaining figure follows the planned path rather than the
 * straight line to the last waypoint, because the straight line is not what
 * the aircraft is going to fly and it makes the ETA optimistic.
 */

import { GeoPoint } from '../telemetry/types';
import { haversineDistanceM, initialBearingDeg } from '../geo/distance';
import { Mission, MissionItem, isNavigationItem } from './types';

/** One straight segment of the planned path. */
export interface MissionLeg {
  fromSeq: number;
  toSeq: number;
  from: GeoPoint;
  to: GeoPoint;
  distanceM: number;
  bearingDeg: number;
}

export interface MissionProgress {
  /** The item the vehicle is flying towards, or null if the mission is done. */
  nextItem: MissionItem | null;
  /** Great-circle distance from the vehicle to that item, metres. */
  distanceToNextM: number | null;
  /** Distance along the remaining planned path, metres. */
  distanceRemainingM: number;
  /** Length of the whole planned path, metres. */
  totalDistanceM: number;
  /** 0..1, by distance rather than by waypoint count. */
  completedFraction: number;
  /** Seconds to the next item at the current groundspeed, or null. */
  etaToNextSeconds: number | null;
  /** Seconds to the end of the mission at the current groundspeed, or null. */
  etaTotalSeconds: number | null;
  /** How many navigation items are left, including the current one. */
  itemsRemaining: number;
}

/**
 * Below this groundspeed an ETA is meaningless: dividing by 0.2 m/s of GPS
 * drift while hovering produces a number in hours and undermines every other
 * figure on the screen.
 */
export const MIN_GROUNDSPEED_FOR_ETA_MS = 0.5;

/** Navigation items only, in sequence order. */
export function navigationItems(mission: Mission): MissionItem[] {
  return mission.items.filter(isNavigationItem).sort((a, b) => a.seq - b.seq);
}

function toPoint(item: MissionItem): GeoPoint {
  return { latDeg: item.latDeg, lonDeg: item.lonDeg, altM: item.altM };
}

/** Straight segments between consecutive navigation items. */
export function missionLegs(mission: Mission): MissionLeg[] {
  const items = navigationItems(mission);
  const legs: MissionLeg[] = [];
  for (let i = 0; i < items.length - 1; i += 1) {
    const from = toPoint(items[i]);
    const to = toPoint(items[i + 1]);
    legs.push({
      fromSeq: items[i].seq,
      toSeq: items[i + 1].seq,
      from,
      to,
      distanceM: haversineDistanceM(from, to),
      bearingDeg: initialBearingDeg(from, to),
    });
  }
  return legs;
}

/** Total planned path length, metres. */
export function totalMissionDistanceM(mission: Mission): number {
  return missionLegs(mission).reduce((sum, leg) => sum + leg.distanceM, 0);
}

/**
 * Compute progress against a mission.
 *
 * `currentSeq` is the sequence number from MISSION_CURRENT. If it points at a
 * non-navigation item (a DO_ command), the next navigation item after it is
 * used, which is what the aircraft is actually flying towards.
 */
export function computeProgress(options: {
  mission: Mission;
  currentSeq: number | null;
  vehicle: GeoPoint | null;
  groundspeedMs: number | null;
}): MissionProgress {
  const { mission, currentSeq, vehicle, groundspeedMs } = options;
  const items = navigationItems(mission);
  const totalDistanceM = totalMissionDistanceM(mission);

  const empty: MissionProgress = {
    nextItem: null,
    distanceToNextM: null,
    distanceRemainingM: 0,
    totalDistanceM,
    completedFraction: items.length === 0 ? 0 : 1,
    etaToNextSeconds: null,
    etaTotalSeconds: null,
    itemsRemaining: 0,
  };
  if (items.length === 0 || currentSeq === null) {
    return { ...empty, completedFraction: 0 };
  }

  const index = items.findIndex((item) => item.seq >= currentSeq);
  if (index < 0) return empty;

  const nextItem = items[index];
  const distanceToNextM = vehicle === null ? null : haversineDistanceM(vehicle, toPoint(nextItem));

  let remainingAlongPath = 0;
  for (let i = index; i < items.length - 1; i += 1) {
    remainingAlongPath += haversineDistanceM(toPoint(items[i]), toPoint(items[i + 1]));
  }
  const distanceRemainingM = (distanceToNextM ?? 0) + remainingAlongPath;

  const speed = groundspeedMs ?? 0;
  const speedUsable = Number.isFinite(speed) && speed >= MIN_GROUNDSPEED_FOR_ETA_MS;

  const completedFraction =
    totalDistanceM <= 0
      ? index / items.length
      : Math.min(1, Math.max(0, 1 - distanceRemainingM / totalDistanceM));

  return {
    nextItem,
    distanceToNextM,
    distanceRemainingM,
    totalDistanceM,
    completedFraction,
    etaToNextSeconds:
      speedUsable && distanceToNextM !== null ? distanceToNextM / speed : null,
    etaTotalSeconds: speedUsable ? distanceRemainingM / speed : null,
    itemsRemaining: items.length - index,
  };
}
