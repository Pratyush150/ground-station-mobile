/**
 * Threshold engine with hysteresis and on/off delays.
 *
 * Four states per rule:
 *
 *   idle --set held for onDelay--> active --clear held for offDelay--> idle
 *
 * with `pending` and `clearing` as the two waiting states. A transient spike
 * that does not survive the on-delay never becomes an alert; a value dithering
 * inside the hysteresis band never clears. Both are what stop the feed from
 * filling with noise the operator learns to swipe away.
 */

import { ActiveAlert, AlertContext, AlertEvent, AlertRule } from './types';

type Phase = 'idle' | 'pending' | 'active' | 'clearing';

interface RuleState {
  phase: Phase;
  /** When the current phase was entered. */
  sinceMs: number;
  raisedAtMs: number;
  message: string;
}

export class AlertEngine {
  private readonly rules: AlertRule[];

  private readonly state = new Map<string, RuleState>();

  private readonly events: AlertEvent[] = [];

  private readonly maxEvents: number;

  constructor(rules: AlertRule[], options: { maxEvents?: number } = {}) {
    this.rules = rules;
    this.maxEvents = options.maxEvents ?? 200;
  }

  /** Rules currently loaded, in declaration order. */
  get ruleIds(): string[] {
    return this.rules.map((rule) => rule.id);
  }

  /**
   * Advance every rule and return the alerts that are active afterwards.
   *
   * Deterministic: the only time source is `context.nowMs`, so a test can step
   * through a whole flight without touching a timer.
   */
  update(context: AlertContext): ActiveAlert[] {
    for (const rule of this.rules) {
      this.updateRule(rule, context);
    }
    return this.active();
  }

  private updateRule(rule: AlertRule, context: AlertContext): void {
    const now = context.nowMs;
    const current =
      this.state.get(rule.id) ??
      ({ phase: 'idle', sinceMs: now, raisedAtMs: 0, message: '' } satisfies RuleState);

    const setNow = rule.set(context);
    const clearNow = rule.clear(context);
    let next: RuleState = current;

    switch (current.phase) {
      case 'idle':
        if (setNow) {
          next = { ...current, phase: 'pending', sinceMs: now };
          if (rule.onDelayMs <= 0) next = this.raise(rule, context, now);
        }
        break;

      case 'pending':
        if (!setNow) {
          next = { ...current, phase: 'idle', sinceMs: now };
        } else if (now - current.sinceMs >= rule.onDelayMs) {
          next = this.raise(rule, context, now);
        }
        break;

      case 'active':
        if (clearNow) {
          next = { ...current, phase: 'clearing', sinceMs: now };
          if (rule.offDelayMs <= 0) next = this.drop(rule, current, now);
        }
        break;

      case 'clearing':
        if (!clearNow) {
          next = { ...current, phase: 'active', sinceMs: now };
        } else if (now - current.sinceMs >= rule.offDelayMs) {
          next = this.drop(rule, current, now);
        }
        break;

      default:
        break;
    }

    this.state.set(rule.id, next);
  }

  private raise(rule: AlertRule, context: AlertContext, now: number): RuleState {
    const message = rule.message(context);
    this.pushEvent({
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
      message,
      atMs: now,
      kind: 'raised',
    });
    return { phase: 'active', sinceMs: now, raisedAtMs: now, message };
  }

  private drop(rule: AlertRule, previous: RuleState, now: number): RuleState {
    this.pushEvent({
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
      message: previous.message,
      atMs: now,
      kind: 'cleared',
    });
    return { phase: 'idle', sinceMs: now, raisedAtMs: 0, message: '' };
  }

  private pushEvent(event: AlertEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
  }

  /** Alerts currently latched, most severe first, then oldest first. */
  active(): ActiveAlert[] {
    const severityRank = { critical: 0, warning: 1, caution: 2, info: 3 } as const;
    const out: ActiveAlert[] = [];
    for (const rule of this.rules) {
      const state = this.state.get(rule.id);
      if (state === undefined) continue;
      if (state.phase !== 'active' && state.phase !== 'clearing') continue;
      out.push({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        message: state.message,
        raisedAtMs: state.raisedAtMs,
        clearing: state.phase === 'clearing',
      });
    }
    return out.sort(
      (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.raisedAtMs - b.raisedAtMs,
    );
  }

  /** True when the named rule is latched. */
  isActive(id: string): boolean {
    const phase = this.state.get(id)?.phase;
    return phase === 'active' || phase === 'clearing';
  }

  /** Internal phase of a rule. Exposed for tests and the diagnostics screen. */
  phaseOf(id: string): Phase {
    return this.state.get(id)?.phase ?? 'idle';
  }

  /** The event feed, oldest first. */
  history(): readonly AlertEvent[] {
    return this.events;
  }

  /** The most severe active alert, for the banner at the top of the screen. */
  highest(): ActiveAlert | null {
    return this.active()[0] ?? null;
  }

  /** Forget everything. Call on disconnect so a new flight starts clean. */
  reset(): void {
    this.state.clear();
    this.events.length = 0;
  }
}
