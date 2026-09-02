/**
 * Battery interpretation.
 *
 * Autopilots report a remaining percentage, but it is often a straight
 * coulomb count that starts from an assumed-full pack. When it is missing
 * (-1) or the pack was not full at power-on, a voltage-based estimate is the
 * fallback. Both are shown, never blended: an operator should know which one
 * they are looking at.
 */

/**
 * Resting open-circuit voltage per cell against state of charge, for LiPo.
 *
 * Ordered high to low. Values are interpolated linearly between breakpoints.
 * Under load the pack sags, so this over-reads discharge during a climb; the
 * `sagCompensationV` argument lets the caller subtract an estimated IR drop.
 */
const LIPO_CURVE: ReadonlyArray<readonly [voltsPerCell: number, percent: number]> = [
  [4.2, 100],
  [4.1, 90],
  [4.0, 80],
  [3.9, 68],
  [3.85, 60],
  [3.8, 50],
  [3.75, 40],
  [3.7, 30],
  [3.65, 20],
  [3.5, 10],
  [3.3, 3],
  [3.0, 0],
];

/** Guess the cell count from a resting pack voltage. */
export function inferCellCount(packVoltageV: number): number {
  if (packVoltageV <= 0) return 0;
  // Cells rest between 3.3 V (nearly empty) and 4.2 V (full). Pick the count
  // whose implied per-cell voltage lands inside that window.
  for (let cells = 1; cells <= 14; cells += 1) {
    const perCell = packVoltageV / cells;
    if (perCell <= 4.25 && perCell >= 3.2) return cells;
  }
  return Math.max(1, Math.round(packVoltageV / 3.7));
}

/** Per-cell voltage for a pack. */
export function cellVoltage(packVoltageV: number, cellCount?: number): number {
  const cells = cellCount && cellCount > 0 ? cellCount : inferCellCount(packVoltageV);
  return cells === 0 ? 0 : packVoltageV / cells;
}

/**
 * State of charge from pack voltage, 0..100.
 *
 * Only a rough guide in flight: current draw drops the terminal voltage well
 * below the resting curve. It is still the number that tells you a pack is
 * genuinely flat rather than mis-counted.
 */
export function stateOfChargeFromVoltage(
  packVoltageV: number,
  cellCount?: number,
  sagCompensationV = 0,
): number {
  const perCell = cellVoltage(packVoltageV, cellCount) + sagCompensationV;
  if (perCell >= LIPO_CURVE[0][0]) return 100;
  const last = LIPO_CURVE[LIPO_CURVE.length - 1];
  if (perCell <= last[0]) return 0;

  for (let i = 0; i < LIPO_CURVE.length - 1; i += 1) {
    const [highV, highPct] = LIPO_CURVE[i];
    const [lowV, lowPct] = LIPO_CURVE[i + 1];
    if (perCell <= highV && perCell >= lowV) {
      const span = highV - lowV;
      const fraction = span === 0 ? 0 : (perCell - lowV) / span;
      return lowPct + fraction * (highPct - lowPct);
    }
  }
  return 0;
}

/**
 * Remaining flight time from consumed capacity and current draw.
 *
 * Deliberately simple: a linear extrapolation of the present draw against the
 * usable capacity. It is honest about being an estimate, and it is the number
 * that changes fastest when the aircraft starts fighting wind.
 * Returns null when there is not enough information to say anything.
 */
export function estimateEnduranceSeconds(options: {
  packCapacityMah: number;
  consumedMah: number;
  currentA: number;
  /** Fraction of the pack you refuse to use. 0.2 is a common reserve. */
  reserveFraction?: number;
}): number | null {
  const { packCapacityMah, consumedMah, currentA } = options;
  const reserve = options.reserveFraction ?? 0.2;
  if (packCapacityMah <= 0 || currentA <= 0.1) return null;
  const usableMah = packCapacityMah * (1 - reserve) - consumedMah;
  if (usableMah <= 0) return 0;
  return (usableMah / (currentA * 1000)) * 3600;
}
