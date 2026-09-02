/**
 * The one place the pipeline is wired together.
 *
 *   link bytes -> FrameParser -> decodeMessage -> VehicleStateStore
 *                                             -> AlertEngine -> React state
 *
 * Two deliberate decisions:
 *
 *  1. **Frames are processed as they arrive; React re-renders on a timer.**
 *     Attitude streams at 10-50 Hz. Calling `setState` per frame would keep
 *     the JS thread busy re-rendering an SVG and would flatten the phone's
 *     battery in an hour. The store is mutated outside React and a snapshot is
 *     published at a fixed, configurable rate.
 *  2. **Nothing here parses.** All the logic lives in `src/core`, which is why
 *     it can be tested without a device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ActiveAlert, AlertEngine, AlertEvent, AlertThresholds, buildDefaultRules } from '@core/alerts';
import { Geofence, checkGeofence } from '@core/geo';
import { LinkConfig, LinkStatus, TelemetryLink, createLink } from '@core/link';
import { DemoLink } from '@core/link/demo';
import { Mission, MissionProgress, computeProgress } from '@core/mission';
import { PlatformAdapters } from '@core/link/adapters';
import { FieldFreshness } from '@core/telemetry/staleness';
import { FrameParser, decodeMessage } from '@core/telemetry/decode';
import { TelemetryField, VehicleState } from '@core/telemetry/types';
import { VehicleStateStore } from '@core/state/vehicle';

export interface TelemetrySnapshot {
  vehicle: VehicleState;
  freshness: Partial<Record<TelemetryField, FieldFreshness>>;
  staleFields: TelemetryField[];
  alerts: ActiveAlert[];
  alertEvents: readonly AlertEvent[];
  progress: MissionProgress | null;
  mission: Mission | null;
  linkStatus: LinkStatus;
  /** Milliseconds since the last decoded frame, or null. */
  linkAgeMs: number | null;
}

export interface UseTelemetryOptions {
  adapters?: PlatformAdapters;
  thresholds?: AlertThresholds;
  geofence?: Geofence | null;
  /** UI refresh rate. 5 Hz is smooth enough to read and cheap enough to run. */
  refreshHz?: number;
}

export interface UseTelemetryResult {
  snapshot: TelemetrySnapshot | null;
  connect: (config: LinkConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  connected: boolean;
  error: string | null;
}

const TRACKED_FIELDS: TelemetryField[] = [
  'attitude',
  'position',
  'battery',
  'gps',
  'airData',
  'heartbeat',
  'missionCurrent',
];

export function useTelemetry(options: UseTelemetryOptions = {}): UseTelemetryResult {
  const { adapters, thresholds, geofence = null, refreshHz = 5 } = options;

  const parser = useRef(new FrameParser());
  const store = useRef(new VehicleStateStore());
  const engine = useMemo(() => new AlertEngine(buildDefaultRules(thresholds)), [thresholds]);
  const link = useRef<TelemetryLink | null>(null);
  const mission = useRef<Mission | null>(null);

  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publish = useCallback(() => {
    const current = link.current;
    if (current === null) return;
    const now = Date.now();

    store.current.applyLinkStats(parser.current.stats, now);
    const vehicle = store.current.current;
    const linkAgeMs = vehicle.link.lastFrameAtMs === null ? null : now - vehicle.link.lastFrameAtMs;
    const position = store.current.positionPoint();
    const staleFields = store.current.staleFields(now, TRACKED_FIELDS);

    const alerts = engine.update({
      nowMs: now,
      armed: vehicle.armedState?.armed ?? false,
      battery:
        vehicle.battery === null
          ? null
          : {
              remainingPct: vehicle.battery.remainingPct,
              voltageV: vehicle.battery.voltageV,
              cellVoltageV: null,
            },
      linkAgeMs,
      gps: vehicle.gps,
      geofence: geofence !== null && position !== null ? checkGeofence(geofence, position) : null,
      staleFields,
    });

    const freshness: Partial<Record<TelemetryField, FieldFreshness>> = {};
    for (const field of TRACKED_FIELDS) {
      freshness[field] = store.current.freshness.freshness(field, now);
    }

    setSnapshot({
      vehicle,
      freshness,
      staleFields,
      alerts,
      alertEvents: engine.history(),
      mission: mission.current,
      progress:
        mission.current === null
          ? null
          : computeProgress({
              mission: mission.current,
              currentSeq: vehicle.currentWaypointSeq,
              vehicle: position,
              groundspeedMs: store.current.groundspeedMs(),
            }),
      linkStatus: current.status,
      linkAgeMs,
    });
  }, [engine, geofence]);

  const disconnect = useCallback(async () => {
    const current = link.current;
    link.current = null;
    setConnected(false);
    if (current !== null) await current.close();
  }, []);

  const connect = useCallback(
    async (config: LinkConfig) => {
      await disconnect();
      setError(null);
      parser.current.reset();
      store.current.reset();
      engine.reset();

      const next = createLink(config, adapters);
      link.current = next;
      mission.current = next instanceof DemoLink ? next.mission : null;

      next.onBytes((bytes) => {
        const now = Date.now();
        for (const frame of parser.current.push(bytes)) {
          const message = decodeMessage(frame);
          if (message !== null) store.current.apply(message, now);
        }
      });

      try {
        await next.open();
        setConnected(true);
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : String(openError));
        setConnected(false);
      }
      publish();
    },
    [adapters, disconnect, engine, publish],
  );

  useEffect(() => {
    if (!connected) return undefined;
    const handle = setInterval(publish, Math.round(1000 / refreshHz));
    return () => clearInterval(handle);
  }, [connected, publish, refreshHz]);

  // Closing the link on unmount matters more than usual here: a UDP socket
  // left bound stops the next connection attempt from binding the same port.
  useEffect(() => () => void disconnect(), [disconnect]);

  return { snapshot, connect, disconnect, connected, error };
}

export default useTelemetry;
