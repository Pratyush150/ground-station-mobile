/**
 * Alert domain types.
 *
 * An alert is a latched condition, not a message. The engine owns whether it
 * is currently true; the UI only renders. Keeping that split means the alert
 * feed and the banner can never disagree about what is active.
 */

import { GeofenceResult } from '../geo/geofence';
import { GpsFixType, TelemetryField } from '../telemetry/types';

export type AlertSeverity = 'info' | 'caution' | 'warning' | 'critical';

/** Everything the rules are allowed to look at. */
export interface AlertContext {
  /** Wall-clock milliseconds. */
  nowMs: number;
  armed: boolean;
  battery: {
    remainingPct: number | null;
    voltageV: number | null;
    cellVoltageV: number | null;
  } | null;
  /** Milliseconds since the last decoded frame, or null if never connected. */
  linkAgeMs: number | null;
  gps: {
    fixType: GpsFixType;
    satellitesVisible: number;
    hdop: number;
  } | null;
  /** Result of checking the current position against the active fence. */
  geofence: GeofenceResult | null;
  /** Telemetry groups currently past their staleness budget. */
  staleFields: readonly TelemetryField[];
}

/**
 * A rule with an explicit set condition and an explicit clear condition.
 *
 * The gap between the two is the hysteresis band. Writing `clear` as the
 * negation of `set` is what makes an alert chatter when a value sits on the
 * threshold, which trains operators to ignore alerts. It is not allowed here:
 * every rule states both.
 */
export interface AlertRule {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** Condition that starts the on-delay timer. */
  set(context: AlertContext): boolean;
  /** Condition that starts the off-delay timer. Must not be `!set`. */
  clear(context: AlertContext): boolean;
  /** `set` must hold this long before the alert becomes active. */
  onDelayMs: number;
  /** `clear` must hold this long before the alert drops. */
  offDelayMs: number;
  /** Text shown in the feed. Evaluated when the alert is raised. */
  message(context: AlertContext): string;
}

/** A currently-latched alert. */
export interface ActiveAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  raisedAtMs: number;
  /** True while the clear condition holds but the off-delay has not expired. */
  clearing: boolean;
}

/** A state change, appended to the alert feed. */
export interface AlertEvent {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  atMs: number;
  kind: 'raised' | 'cleared';
}
