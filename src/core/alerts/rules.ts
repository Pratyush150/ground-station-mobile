/**
 * The default rule set.
 *
 * Thresholds are defaults, not doctrine: every one is exposed in Settings
 * because a 3S 1500 mAh racer and a 12S survey aircraft do not want the same
 * numbers. What is not configurable is the shape: every rule has a hysteresis
 * band and a delay, so none of them can chatter.
 */

import { GpsFixType } from '../telemetry/types';
import { AlertContext, AlertRule } from './types';

export interface AlertThresholds {
  /** Battery percentage that raises a caution / clears it again. */
  batteryLowPct: number;
  batteryLowClearPct: number;
  /** Battery percentage that raises a critical alert / clears it again. */
  batteryCriticalPct: number;
  batteryCriticalClearPct: number;
  batteryOnDelayMs: number;
  /** Frame age that counts as link loss / recovery. */
  linkLossMs: number;
  linkRecoveredMs: number;
  /** GPS quality floor and the better figures needed to clear. */
  minSatellites: number;
  clearSatellites: number;
  maxHdop: number;
  clearHdop: number;
  gpsOnDelayMs: number;
  /** Metres inside the fence required before a breach clears. */
  geofenceClearMarginM: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  batteryLowPct: 25,
  batteryLowClearPct: 30,
  batteryCriticalPct: 15,
  batteryCriticalClearPct: 20,
  batteryOnDelayMs: 3000,
  linkLossMs: 3000,
  linkRecoveredMs: 1500,
  minSatellites: 6,
  clearSatellites: 8,
  maxHdop: 3.0,
  clearHdop: 2.5,
  gpsOnDelayMs: 4000,
  geofenceClearMarginM: 10,
};

function batteryPercent(context: AlertContext): number | null {
  const pct = context.battery?.remainingPct ?? null;
  if (pct === null || !Number.isFinite(pct) || pct < 0) return null;
  return pct;
}

/**
 * Build the standard rules.
 *
 * Ordering matters only for display; the engine evaluates all of them every
 * update regardless.
 */
export function buildDefaultRules(
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
): AlertRule[] {
  return [
    {
      id: 'battery-critical',
      severity: 'critical',
      title: 'Battery critical',
      onDelayMs: Math.min(1000, thresholds.batteryOnDelayMs),
      offDelayMs: 5000,
      set: (ctx) => {
        const pct = batteryPercent(ctx);
        return pct !== null && pct <= thresholds.batteryCriticalPct;
      },
      clear: (ctx) => {
        const pct = batteryPercent(ctx);
        return pct === null || pct >= thresholds.batteryCriticalClearPct;
      },
      message: (ctx) =>
        `Battery ${Math.round(batteryPercent(ctx) ?? 0)} %. Land now.`,
    },
    {
      id: 'battery-low',
      severity: 'warning',
      title: 'Battery low',
      onDelayMs: thresholds.batteryOnDelayMs,
      offDelayMs: 5000,
      set: (ctx) => {
        const pct = batteryPercent(ctx);
        return pct !== null && pct <= thresholds.batteryLowPct;
      },
      clear: (ctx) => {
        const pct = batteryPercent(ctx);
        return pct === null || pct >= thresholds.batteryLowClearPct;
      },
      message: (ctx) =>
        `Battery ${Math.round(batteryPercent(ctx) ?? 0)} %. Plan the return leg.`,
    },
    {
      id: 'link-loss',
      severity: 'critical',
      title: 'Telemetry link lost',
      // No on-delay: the age threshold is itself the delay, and a link that
      // has been quiet for three seconds is already news.
      onDelayMs: 0,
      offDelayMs: 1000,
      set: (ctx) => ctx.linkAgeMs !== null && ctx.linkAgeMs >= thresholds.linkLossMs,
      clear: (ctx) => ctx.linkAgeMs !== null && ctx.linkAgeMs <= thresholds.linkRecoveredMs,
      message: (ctx) =>
        `No frames for ${((ctx.linkAgeMs ?? 0) / 1000).toFixed(1)} s.`,
    },
    {
      id: 'gps-degraded',
      severity: 'warning',
      title: 'GPS degraded',
      onDelayMs: thresholds.gpsOnDelayMs,
      offDelayMs: 4000,
      set: (ctx) => {
        if (ctx.gps === null) return false;
        const badFix = ctx.gps.fixType < GpsFixType.Fix3D;
        const fewSats = ctx.gps.satellitesVisible < thresholds.minSatellites;
        const poorHdop = Number.isFinite(ctx.gps.hdop) && ctx.gps.hdop > thresholds.maxHdop;
        return badFix || fewSats || poorHdop;
      },
      clear: (ctx) => {
        if (ctx.gps === null) return true;
        const goodFix = ctx.gps.fixType >= GpsFixType.Fix3D;
        const enoughSats = ctx.gps.satellitesVisible >= thresholds.clearSatellites;
        const goodHdop = !Number.isFinite(ctx.gps.hdop) || ctx.gps.hdop <= thresholds.clearHdop;
        return goodFix && enoughSats && goodHdop;
      },
      message: (ctx) =>
        `Fix ${ctx.gps?.fixType ?? 0}, ${ctx.gps?.satellitesVisible ?? 0} satellites, HDOP ${
          Number.isFinite(ctx.gps?.hdop ?? NaN) ? (ctx.gps?.hdop ?? 0).toFixed(1) : '--'
        }.`,
    },
    {
      id: 'geofence-breach',
      severity: 'critical',
      title: 'Geofence breach',
      // Immediate: the aircraft is already outside. The off-delay plus the
      // clear margin stop it flickering while it hovers on the boundary.
      onDelayMs: 0,
      offDelayMs: 2000,
      set: (ctx) => ctx.geofence !== null && !ctx.geofence.inside,
      clear: (ctx) =>
        ctx.geofence === null ||
        (ctx.geofence.inside && ctx.geofence.lateralMarginM >= thresholds.geofenceClearMarginM),
      message: (ctx) => {
        const reasons = ctx.geofence?.reasons ?? [];
        return `Outside fence (${reasons.join(', ') || 'unknown'}).`;
      },
    },
    {
      id: 'stale-telemetry',
      severity: 'warning',
      title: 'Telemetry stale',
      // Two seconds, not zero: at connect time every field is "never seen",
      // and raising an alert for the first heartbeat that has not arrived yet
      // trains the operator to dismiss the one that matters.
      onDelayMs: 2000,
      offDelayMs: 500,
      set: (ctx) => ctx.staleFields.length > 0,
      clear: (ctx) => ctx.staleFields.length === 0,
      message: (ctx) => `No fresh ${ctx.staleFields.join(', ')} data.`,
    },
  ];
}
