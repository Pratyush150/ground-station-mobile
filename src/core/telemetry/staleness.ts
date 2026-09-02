/**
 * Per-field age tracking.
 *
 * A ground station that keeps drawing the last altitude it received, in the
 * same colour, after the stream has stopped is actively dangerous: the number
 * looks live. Every telemetry group therefore carries its own age, and the UI
 * renders "stale" differently from "live".
 *
 * Ages are wall-clock, taken from an injectable clock so tests do not sleep.
 */

/** Freshness of one telemetry group. */
export type FreshnessStatus = 'never' | 'live' | 'stale';

export interface FieldFreshness {
  status: FreshnessStatus;
  /** Milliseconds since the last update, or null if never updated. */
  ageMs: number | null;
  /** The age at which this field is considered stale. */
  maxAgeMs: number;
}

/**
 * Default staleness budgets, in milliseconds.
 *
 * These are roughly three missed frames at the usual PX4 stream rates:
 * attitude streams fast and going quiet matters immediately; a heartbeat is
 * 1 Hz so it gets a longer budget. Tune per airframe in Settings.
 */
export const DEFAULT_MAX_AGE_MS = {
  attitude: 1000,
  position: 2000,
  battery: 3000,
  gps: 3000,
  airData: 2000,
  heartbeat: 3000,
  missionCurrent: 5000,
} as const;

/**
 * Tracks when each named field was last updated and reports whether it is
 * still trustworthy.
 *
 * Generic over the key set so it can be reused for anything else that ages
 * (per-sensor health, per-camera frame arrival).
 */
export class StalenessTracker<K extends string> {
  private readonly lastUpdateMs = new Map<K, number>();

  private readonly budgets: Map<K, number>;

  private readonly defaultMaxAgeMs: number;

  constructor(budgets: Partial<Record<K, number>>, defaultMaxAgeMs = 2000) {
    this.budgets = new Map(Object.entries(budgets) as [K, number][]);
    this.defaultMaxAgeMs = defaultMaxAgeMs;
  }

  /** Record that `field` was just updated at wall-clock `nowMs`. */
  mark(field: K, nowMs: number): void {
    this.lastUpdateMs.set(field, nowMs);
  }

  /** Staleness budget in force for `field`. */
  maxAgeMs(field: K): number {
    return this.budgets.get(field) ?? this.defaultMaxAgeMs;
  }

  /** Override the budget for one field, e.g. from Settings. */
  setMaxAgeMs(field: K, maxAgeMs: number): void {
    this.budgets.set(field, maxAgeMs);
  }

  /** Milliseconds since `field` was last updated, or null if never. */
  ageMs(field: K, nowMs: number): number | null {
    const last = this.lastUpdateMs.get(field);
    return last === undefined ? null : nowMs - last;
  }

  /**
   * True when the field is too old to display as live.
   *
   * A field that has never arrived is stale: showing an empty box as if it
   * were merely quiet would be just as misleading as a frozen number.
   * The boundary is inclusive of the budget: age === maxAge is still live,
   * age === maxAge + 1 is stale.
   */
  isStale(field: K, nowMs: number): boolean {
    const age = this.ageMs(field, nowMs);
    if (age === null) return true;
    return age > this.maxAgeMs(field);
  }

  /** Full freshness record for one field. */
  freshness(field: K, nowMs: number): FieldFreshness {
    const age = this.ageMs(field, nowMs);
    const maxAge = this.maxAgeMs(field);
    if (age === null) return { status: 'never', ageMs: null, maxAgeMs: maxAge };
    return { status: age > maxAge ? 'stale' : 'live', ageMs: age, maxAgeMs: maxAge };
  }

  /** Freshness for every field that has ever been marked. */
  snapshot(nowMs: number): Record<string, FieldFreshness> {
    const out: Record<string, FieldFreshness> = {};
    for (const field of this.lastUpdateMs.keys()) {
      out[field] = this.freshness(field, nowMs);
    }
    return out;
  }

  /** Every field currently stale, oldest first. Drives the alert engine. */
  staleFields(nowMs: number, candidates: readonly K[]): K[] {
    return candidates
      .filter((field) => this.isStale(field, nowMs))
      .sort((a, b) => (this.ageMs(b, nowMs) ?? Infinity) - (this.ageMs(a, nowMs) ?? Infinity));
  }

  /** Forget all history. Call when a link is closed or reconnected. */
  reset(): void {
    this.lastUpdateMs.clear();
  }
}
