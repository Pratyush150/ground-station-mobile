/**
 * Geofence containment checks.
 *
 * Two shapes cover what field operators actually set up: a radius around the
 * home point ("stay within 500 m of me") and a polygon drawn on the map ("stay
 * inside this field, not over the road"). Both get an optional altitude
 * ceiling and floor.
 *
 * These checks are advisory. The authoritative fence lives on the autopilot;
 * this one exists so the operator sees the breach on the phone at the same
 * time the aircraft acts on it, and so a fence can be monitored even when the
 * vehicle has none configured.
 */

import { GeoPoint } from '../telemetry/types';
import { haversineDistanceM } from './distance';

/** A circular fence centred on a point. */
export interface CircularGeofence {
  kind: 'circle';
  centre: GeoPoint;
  radiusM: number;
  maxAltM?: number;
  minAltM?: number;
}

/** A polygon fence. Vertices in order; the ring is closed implicitly. */
export interface PolygonGeofence {
  kind: 'polygon';
  vertices: GeoPoint[];
  maxAltM?: number;
  minAltM?: number;
}

export type Geofence = CircularGeofence | PolygonGeofence;

/** Why a position is outside the fence. */
export type BreachReason = 'lateral' | 'ceiling' | 'floor';

export interface GeofenceResult {
  inside: boolean;
  reasons: BreachReason[];
  /**
   * Metres to the nearest lateral boundary. Positive inside, negative outside.
   * Only exact for circular fences; for polygons it is the distance to the
   * closest vertex, which is a conservative approximation good enough to drive
   * an "approaching fence" warning.
   */
  lateralMarginM: number;
}

/**
 * Ray-casting point-in-polygon test.
 *
 * Works in raw lat/lon degrees. That is fine for fences of the size a UAV
 * operator draws; it is not valid across the antimeridian or over a pole, and
 * the fence editor rejects those cases rather than silently mis-testing them.
 */
export function pointInPolygon(point: GeoPoint, vertices: readonly GeoPoint[]): boolean {
  if (vertices.length < 3) return false;
  const x = point.lonDeg;
  const y = point.latDeg;
  let inside = false;

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const xi = vertices[i].lonDeg;
    const yi = vertices[i].latDeg;
    const xj = vertices[j].lonDeg;
    const yj = vertices[j].latDeg;

    const straddles = yi > y !== yj > y;
    if (!straddles) continue;
    const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < xCross) inside = !inside;
  }
  return inside;
}

/** Distance to the closest polygon vertex, metres. */
function nearestVertexDistanceM(point: GeoPoint, vertices: readonly GeoPoint[]): number {
  let best = Infinity;
  for (const vertex of vertices) {
    const d = haversineDistanceM(point, vertex);
    if (d < best) best = d;
  }
  return best;
}

/** Test a position against a fence, returning every reason it is out. */
export function checkGeofence(fence: Geofence, position: GeoPoint): GeofenceResult {
  const reasons: BreachReason[] = [];
  let lateralMarginM: number;

  if (fence.kind === 'circle') {
    const distance = haversineDistanceM(fence.centre, position);
    lateralMarginM = fence.radiusM - distance;
    if (lateralMarginM < 0) reasons.push('lateral');
  } else {
    const inside = pointInPolygon(position, fence.vertices);
    const toEdge = nearestVertexDistanceM(position, fence.vertices);
    lateralMarginM = inside ? toEdge : -toEdge;
    if (!inside) reasons.push('lateral');
  }

  const alt = position.altM;
  if (alt !== undefined) {
    if (fence.maxAltM !== undefined && alt > fence.maxAltM) reasons.push('ceiling');
    if (fence.minAltM !== undefined && alt < fence.minAltM) reasons.push('floor');
  }

  return { inside: reasons.length === 0, reasons, lateralMarginM };
}
