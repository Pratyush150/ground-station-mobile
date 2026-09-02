/**
 * Dark theme, sized for outdoor use.
 *
 * Design constraints that come from the field, not from taste:
 *
 *  - **Sunlight.** A light theme on a phone at 60 percent brightness in
 *    daylight is unreadable. Everything is dark with high-contrast text, and
 *    the accent colours are chosen to stay distinguishable through polarised
 *    sunglasses.
 *  - **Gloves and one hand.** The other hand is on the transmitter. Minimum
 *    touch target is 56 points, well above the 44 the platform guidelines ask
 *    for, and the primary actions sit in the lower half of the screen.
 *  - **Colour is never the only signal.** Stale values also lose their digits
 *    to dashes and gain a hatch overlay, because red/green alone fails for
 *    roughly one man in twelve and fails for everyone in bright sun.
 */

export const colors = {
  background: '#0B0F14',
  surface: '#131A22',
  surfaceRaised: '#1B242E',
  border: '#26313D',

  text: '#E8EDF2',
  textMuted: '#93A1B0',
  textDisabled: '#5A6774',

  accent: '#3FA7FF',
  ok: '#31C36B',
  caution: '#F2C33C',
  warning: '#F59133',
  critical: '#E5484D',

  /** Artificial horizon. Deliberately desaturated: it sits behind data. */
  sky: '#2C5C86',
  ground: '#6B4A2A',
  horizonLine: '#E8EDF2',

  /** Stale telemetry: grey, plus a hatch pattern drawn over the value. */
  stale: '#5A6774',
  staleOverlay: 'rgba(11, 15, 20, 0.55)',

  trackPlanned: '#3FA7FF',
  trackFlown: '#31C36B',
  vehicle: '#FFFFFF',
  geofence: '#F2C33C',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 14,
} as const;

/**
 * Type scale.
 *
 * `readout` is the size used for numbers a pilot reads at arm's length while
 * also looking at the aircraft. It is deliberately larger than anything a
 * regular app would use for a data field.
 */
export const typography = {
  readoutLarge: { fontSize: 40, fontWeight: '700' as const, letterSpacing: -0.5 },
  readout: { fontSize: 28, fontWeight: '700' as const },
  readoutSmall: { fontSize: 20, fontWeight: '600' as const },
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 1.1 },
  body: { fontSize: 15, fontWeight: '400' as const },
  mono: { fontSize: 14, fontWeight: '500' as const },
} as const;

/** Minimum touch target, in points. Larger than the platform minimum on purpose. */
export const TOUCH_TARGET = 56;

/** Colour for an alert severity. */
export function severityColor(severity: 'info' | 'caution' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'critical':
      return colors.critical;
    case 'warning':
      return colors.warning;
    case 'caution':
      return colors.caution;
    default:
      return colors.accent;
  }
}

/** Colour for a battery percentage, matching the alert thresholds. */
export function batteryColor(percent: number | null): string {
  if (percent === null || percent < 0) return colors.textDisabled;
  if (percent <= 15) return colors.critical;
  if (percent <= 25) return colors.warning;
  return colors.ok;
}
