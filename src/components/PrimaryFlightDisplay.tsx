/**
 * Primary flight display.
 *
 * Artificial horizon with a pitch ladder and roll scale, a heading tape along
 * the top, and speed and altitude tapes down each side. Drawn with
 * react-native-svg rather than images so it scales to any screen and stays
 * crisp, and so the pitch ladder can be generated instead of hand-drawn.
 *
 * Two decisions worth stating, because they are safety-relevant:
 *
 *  1. **Stale attitude is not drawn as if it were live.** When the attitude
 *     stream is older than its budget the horizon is dimmed, a hatch is drawn
 *     over it, and an ATT STALE flag appears. A frozen horizon that still
 *     looks live is the single most dangerous thing a PFD can do.
 *  2. **The horizon moves, the aircraft symbol does not.** That is the
 *     convention every fixed-reference PFD uses, and switching it to save
 *     maths would put an operator's instincts in the wrong place.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import { colors } from '@theme/index';

export interface PrimaryFlightDisplayProps {
  rollRad: number;
  pitchRad: number;
  headingDeg: number;
  /** Altitude above home, metres. Converted by the caller if needed. */
  altitude: number | null;
  altitudeUnit: string;
  speed: number | null;
  speedUnit: string;
  verticalSpeed: number | null;
  /** Attitude is older than its staleness budget. */
  attitudeStale: boolean;
  /** Position or air data is older than its budget. */
  dataStale: boolean;
  width: number;
  height: number;
}

/** Screen pixels per degree of pitch on the ladder. */
const PIXELS_PER_PITCH_DEGREE = 6;
/** Roll scale tick positions, degrees. */
const ROLL_TICKS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
const TAPE_WIDTH = 62;
const HEADING_TAPE_HEIGHT = 34;

const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function PrimaryFlightDisplay({
  rollRad,
  pitchRad,
  headingDeg,
  altitude,
  altitudeUnit,
  speed,
  speedUnit,
  verticalSpeed,
  attitudeStale,
  dataStale,
  width,
  height,
}: PrimaryFlightDisplayProps): React.JSX.Element {
  const centreX = width / 2;
  const centreY = height / 2 + HEADING_TAPE_HEIGHT / 2;
  const rollDeg = toDeg(rollRad);
  const pitchDeg = toDeg(pitchRad);

  // The horizon has to cover the whole viewport at any roll angle, so it is
  // drawn on a square big enough to survive rotation about the centre.
  const span = Math.hypot(width, height) * 1.2;

  const pitchLadder = useMemo(() => buildPitchLadder(), []);
  const altitudeTicks = useMemo(() => buildTapeTicks(altitude, 10, 6), [altitude]);
  const speedTicks = useMemo(() => buildTapeTicks(speed, 5, 6), [speed]);
  const headingTicks = useMemo(() => buildHeadingTicks(headingDeg), [headingDeg]);

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <ClipPath id="horizonClip">
            <Rect x={0} y={HEADING_TAPE_HEIGHT} width={width} height={height - HEADING_TAPE_HEIGHT} />
          </ClipPath>
          <ClipPath id="tapeClipLeft">
            <Rect x={0} y={HEADING_TAPE_HEIGHT} width={TAPE_WIDTH} height={height - HEADING_TAPE_HEIGHT} />
          </ClipPath>
          <ClipPath id="tapeClipRight">
            <Rect
              x={width - TAPE_WIDTH}
              y={HEADING_TAPE_HEIGHT}
              width={TAPE_WIDTH}
              height={height - HEADING_TAPE_HEIGHT}
            />
          </ClipPath>
        </Defs>

        <G clipPath="url(#horizonClip)">
          {/* Sky, ground and pitch ladder, rotated by roll and shifted by pitch. */}
          <G
            transform={`rotate(${-rollDeg}, ${centreX}, ${centreY}) translate(0, ${
              pitchDeg * PIXELS_PER_PITCH_DEGREE
            })`}
          >
            <Rect
              x={centreX - span / 2}
              y={centreY - span}
              width={span}
              height={span}
              fill={attitudeStale ? colors.stale : colors.sky}
            />
            <Rect
              x={centreX - span / 2}
              y={centreY}
              width={span}
              height={span}
              fill={attitudeStale ? colors.border : colors.ground}
            />
            <Line
              x1={centreX - span / 2}
              y1={centreY}
              x2={centreX + span / 2}
              y2={centreY}
              stroke={colors.horizonLine}
              strokeWidth={2}
            />

            {pitchLadder.map((rung) => {
              const y = centreY - rung.degrees * PIXELS_PER_PITCH_DEGREE;
              const halfWidth = rung.major ? 44 : 22;
              return (
                <G key={`pitch-${rung.degrees}`}>
                  <Line
                    x1={centreX - halfWidth}
                    y1={y}
                    x2={centreX + halfWidth}
                    y2={y}
                    stroke={colors.horizonLine}
                    strokeWidth={rung.major ? 2 : 1}
                    opacity={0.9}
                  />
                  {rung.major ? (
                    <>
                      <SvgText
                        x={centreX - halfWidth - 6}
                        y={y + 4}
                        fill={colors.horizonLine}
                        fontSize={11}
                        textAnchor="end"
                      >
                        {Math.abs(rung.degrees)}
                      </SvgText>
                      <SvgText
                        x={centreX + halfWidth + 6}
                        y={y + 4}
                        fill={colors.horizonLine}
                        fontSize={11}
                        textAnchor="start"
                      >
                        {Math.abs(rung.degrees)}
                      </SvgText>
                    </>
                  ) : null}
                </G>
              );
            })}
          </G>

          {/* Roll scale: fixed arc, moving pointer. */}
          <G>
            {ROLL_TICKS.map((tick) => {
              const angle = ((tick - 90) * Math.PI) / 180;
              const outer = 96;
              const inner = tick % 30 === 0 ? 82 : 88;
              return (
                <Line
                  key={`roll-${tick}`}
                  x1={centreX + Math.cos(angle) * inner}
                  y1={centreY + Math.sin(angle) * inner}
                  x2={centreX + Math.cos(angle) * outer}
                  y2={centreY + Math.sin(angle) * outer}
                  stroke={colors.text}
                  strokeWidth={tick === 0 ? 2 : 1}
                  opacity={0.85}
                />
              );
            })}
            <Polygon
              points={rollPointer(centreX, centreY, rollDeg)}
              fill={attitudeStale ? colors.stale : colors.caution}
            />
          </G>

          {/* Fixed aircraft symbol. */}
          <G>
            <Line
              x1={centreX - 60}
              y1={centreY}
              x2={centreX - 20}
              y2={centreY}
              stroke={colors.caution}
              strokeWidth={4}
            />
            <Line
              x1={centreX + 20}
              y1={centreY}
              x2={centreX + 60}
              y2={centreY}
              stroke={colors.caution}
              strokeWidth={4}
            />
            <Circle cx={centreX} cy={centreY} r={3} fill={colors.caution} />
          </G>

          {attitudeStale ? <StaleHatch width={width} height={height} /> : null}
        </G>

        {/* Speed tape, left. */}
        <G clipPath="url(#tapeClipLeft)">
          <Rect
            x={0}
            y={HEADING_TAPE_HEIGHT}
            width={TAPE_WIDTH}
            height={height - HEADING_TAPE_HEIGHT}
            fill={colors.background}
            opacity={0.55}
          />
          {speedTicks.map((tick) => (
            <G key={`spd-${tick.value}`}>
              <Line
                x1={TAPE_WIDTH - 12}
                y1={centreY - tick.offset * 26}
                x2={TAPE_WIDTH}
                y2={centreY - tick.offset * 26}
                stroke={colors.textMuted}
                strokeWidth={1}
              />
              <SvgText
                x={TAPE_WIDTH - 16}
                y={centreY - tick.offset * 26 + 4}
                fill={colors.textMuted}
                fontSize={12}
                textAnchor="end"
              >
                {tick.value}
              </SvgText>
            </G>
          ))}
        </G>
        <ReadoutBox
          x={2}
          y={centreY - 17}
          width={TAPE_WIDTH - 4}
          label={speedUnit}
          value={formatReadout(speed, dataStale)}
          stale={dataStale}
        />

        {/* Altitude tape, right, with vertical speed under it. */}
        <G clipPath="url(#tapeClipRight)">
          <Rect
            x={width - TAPE_WIDTH}
            y={HEADING_TAPE_HEIGHT}
            width={TAPE_WIDTH}
            height={height - HEADING_TAPE_HEIGHT}
            fill={colors.background}
            opacity={0.55}
          />
          {altitudeTicks.map((tick) => (
            <G key={`alt-${tick.value}`}>
              <Line
                x1={width - TAPE_WIDTH}
                y1={centreY - tick.offset * 26}
                x2={width - TAPE_WIDTH + 12}
                y2={centreY - tick.offset * 26}
                stroke={colors.textMuted}
                strokeWidth={1}
              />
              <SvgText
                x={width - TAPE_WIDTH + 16}
                y={centreY - tick.offset * 26 + 4}
                fill={colors.textMuted}
                fontSize={12}
                textAnchor="start"
              >
                {tick.value}
              </SvgText>
            </G>
          ))}
        </G>
        <ReadoutBox
          x={width - TAPE_WIDTH + 2}
          y={centreY - 17}
          width={TAPE_WIDTH - 4}
          label={altitudeUnit}
          value={formatReadout(altitude, dataStale)}
          stale={dataStale}
        />
        <SvgText
          x={width - TAPE_WIDTH / 2}
          y={centreY + 44}
          fill={verticalSpeed !== null && verticalSpeed < -0.5 ? colors.caution : colors.textMuted}
          fontSize={13}
          textAnchor="middle"
        >
          {verticalSpeed === null || dataStale ? '--' : `${verticalSpeed >= 0 ? '+' : ''}${verticalSpeed.toFixed(1)}`}
        </SvgText>

        {/* Heading tape, top. */}
        <Rect x={0} y={0} width={width} height={HEADING_TAPE_HEIGHT} fill={colors.surface} />
        {headingTicks.map((tick) => {
          const x = centreX + tick.offsetDeg * 3;
          if (x < 0 || x > width) return null;
          return (
            <G key={`hdg-${tick.label}-${tick.offsetDeg}`}>
              <Line
                x1={x}
                y1={HEADING_TAPE_HEIGHT - (tick.major ? 12 : 7)}
                x2={x}
                y2={HEADING_TAPE_HEIGHT}
                stroke={colors.textMuted}
                strokeWidth={1}
              />
              {tick.major ? (
                <SvgText x={x} y={14} fill={colors.text} fontSize={12} textAnchor="middle">
                  {tick.label}
                </SvgText>
              ) : null}
            </G>
          );
        })}
        <Polygon
          points={`${centreX - 7},${HEADING_TAPE_HEIGHT} ${centreX + 7},${HEADING_TAPE_HEIGHT} ${centreX},${
            HEADING_TAPE_HEIGHT + 9
          }`}
          fill={colors.accent}
        />

        {attitudeStale ? (
          <SvgText
            x={centreX}
            y={centreY - 70}
            fill={colors.critical}
            fontSize={16}
            fontWeight="bold"
            textAnchor="middle"
          >
            ATT STALE
          </SvgText>
        ) : null}
      </Svg>
    </View>
  );
}

/** Diagonal hatch drawn over a frozen horizon. */
function StaleHatch({ width, height }: { width: number; height: number }): React.JSX.Element {
  const lines: React.JSX.Element[] = [];
  for (let x = -height; x < width; x += 18) {
    lines.push(
      <Path
        key={`hatch-${x}`}
        d={`M ${x} ${height} L ${x + height} 0`}
        stroke={colors.stale}
        strokeWidth={1}
        opacity={0.45}
      />,
    );
  }
  return <G>{lines}</G>;
}

interface ReadoutBoxProps {
  x: number;
  y: number;
  width: number;
  label: string;
  value: string;
  stale: boolean;
}

function ReadoutBox({ x, y, width, label, value, stale }: ReadoutBoxProps): React.JSX.Element {
  return (
    <G>
      <Rect
        x={x}
        y={y}
        width={width}
        height={34}
        rx={4}
        fill={colors.surfaceRaised}
        stroke={stale ? colors.stale : colors.accent}
        strokeWidth={1.5}
        opacity={0.95}
      />
      <SvgText
        x={x + width / 2}
        y={y + 22}
        fill={stale ? colors.stale : colors.text}
        fontSize={17}
        fontWeight="bold"
        textAnchor="middle"
      >
        {value}
      </SvgText>
      <SvgText x={x + width / 2} y={y + 46} fill={colors.textMuted} fontSize={10} textAnchor="middle">
        {label}
      </SvgText>
    </G>
  );
}

function formatReadout(value: number | null, stale: boolean): string {
  if (stale || value === null || !Number.isFinite(value)) return '--';
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

interface PitchRung {
  degrees: number;
  major: boolean;
}

/** Ladder rungs every 5 degrees, labelled every 10, from -30 to +30. */
function buildPitchLadder(): PitchRung[] {
  const rungs: PitchRung[] = [];
  for (let degrees = -30; degrees <= 30; degrees += 5) {
    if (degrees === 0) continue;
    rungs.push({ degrees, major: degrees % 10 === 0 });
  }
  return rungs;
}

interface TapeTick {
  value: number;
  /** Distance from the centre, in tick intervals. */
  offset: number;
}

/** Ticks around the current value, snapped to a round interval. */
function buildTapeTicks(value: number | null, interval: number, count: number): TapeTick[] {
  if (value === null || !Number.isFinite(value)) return [];
  const base = Math.round(value / interval) * interval;
  const ticks: TapeTick[] = [];
  for (let i = -count; i <= count; i += 1) {
    const tickValue = base + i * interval;
    ticks.push({ value: tickValue, offset: (tickValue - value) / interval });
  }
  return ticks;
}

interface HeadingTick {
  label: string;
  offsetDeg: number;
  major: boolean;
}

/** Ticks every 5 degrees, cardinal letters and numbers every 30. */
function buildHeadingTicks(headingDeg: number): HeadingTick[] {
  const ticks: HeadingTick[] = [];
  if (!Number.isFinite(headingDeg)) return ticks;
  const centre = Math.round(headingDeg / 5) * 5;
  for (let i = -12; i <= 12; i += 1) {
    const value = centre + i * 5;
    const wrapped = ((value % 360) + 360) % 360;
    const major = wrapped % 30 === 0;
    ticks.push({
      label: headingLabel(wrapped),
      offsetDeg: value - headingDeg,
      major,
    });
  }
  return ticks;
}

function headingLabel(deg: number): string {
  switch (deg) {
    case 0:
      return 'N';
    case 90:
      return 'E';
    case 180:
      return 'S';
    case 270:
      return 'W';
    default:
      return String(deg / 10).padStart(2, '0');
  }
}

/** Triangle pointing at the current bank angle on the roll scale. */
function rollPointer(centreX: number, centreY: number, rollDeg: number): string {
  const angle = ((-rollDeg - 90) * Math.PI) / 180;
  const radius = 78;
  const tipX = centreX + Math.cos(angle) * radius;
  const tipY = centreY + Math.sin(angle) * radius;
  const leftAngle = angle + 0.05;
  const rightAngle = angle - 0.05;
  return [
    `${tipX},${tipY}`,
    `${centreX + Math.cos(leftAngle) * (radius - 14)},${centreY + Math.sin(leftAngle) * (radius - 14)}`,
    `${centreX + Math.cos(rightAngle) * (radius - 14)},${centreY + Math.sin(rightAngle) * (radius - 14)}`,
  ].join(' ');
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    overflow: 'hidden',
    borderRadius: 12,
  },
});

export default PrimaryFlightDisplay;
