import { describe, expect, it } from 'vitest';

import { StalenessTracker } from '../src/core/telemetry/staleness';

type Field = 'attitude' | 'position';

describe('StalenessTracker', () => {
  it('treats a field that never arrived as stale, not as fresh-and-empty', () => {
    const tracker = new StalenessTracker<Field>({ attitude: 1000, position: 2000 });
    expect(tracker.isStale('attitude', 0)).toBe(true);
    expect(tracker.freshness('attitude', 0).status).toBe('never');
    expect(tracker.ageMs('attitude', 0)).toBeNull();
  });

  it('goes stale one millisecond past the budget, not before', () => {
    const tracker = new StalenessTracker<Field>({ attitude: 1000, position: 2000 });
    tracker.mark('attitude', 10_000);

    expect(tracker.isStale('attitude', 10_999)).toBe(false);
    expect(tracker.isStale('attitude', 11_000)).toBe(false); // exactly the budget
    expect(tracker.isStale('attitude', 11_001)).toBe(true);
    expect(tracker.freshness('attitude', 11_001).status).toBe('stale');
    expect(tracker.freshness('attitude', 11_001).ageMs).toBe(1001);
  });

  it('comes back to live as soon as a fresh sample arrives', () => {
    const tracker = new StalenessTracker<Field>({ attitude: 1000, position: 2000 });
    tracker.mark('attitude', 0);
    expect(tracker.isStale('attitude', 5000)).toBe(true);
    tracker.mark('attitude', 5000);
    expect(tracker.isStale('attitude', 5000)).toBe(false);
    expect(tracker.freshness('attitude', 5100).status).toBe('live');
  });

  it('ages each field independently', () => {
    const tracker = new StalenessTracker<Field>({ attitude: 1000, position: 2000 });
    tracker.mark('attitude', 0);
    tracker.mark('position', 0);
    expect(tracker.isStale('attitude', 1500)).toBe(true);
    expect(tracker.isStale('position', 1500)).toBe(false);
  });

  it('lists stale fields oldest first', () => {
    const tracker = new StalenessTracker<Field>({ attitude: 1000, position: 1000 });
    tracker.mark('position', 0);
    tracker.mark('attitude', 500);
    expect(tracker.staleFields(3000, ['attitude', 'position'])).toEqual(['position', 'attitude']);
  });

  it('uses the default budget for fields with no explicit one', () => {
    const tracker = new StalenessTracker<Field>({}, 750);
    tracker.mark('attitude', 0);
    expect(tracker.maxAgeMs('attitude')).toBe(750);
    expect(tracker.isStale('attitude', 800)).toBe(true);
  });

  it('forgets everything on reset, as after a reconnect', () => {
    const tracker = new StalenessTracker<Field>({ attitude: 1000 });
    tracker.mark('attitude', 0);
    tracker.reset();
    expect(tracker.freshness('attitude', 10).status).toBe('never');
  });
});
