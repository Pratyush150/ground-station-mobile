/**
 * One telemetry pipeline, shared by every screen.
 *
 * The link, parser and alert engine are created once at the root. Screens
 * subscribe to the published snapshot; switching tabs must never tear down a
 * link that is receiving telemetry from an aircraft in the air.
 */

import React, { createContext, useContext, useMemo } from 'react';

import { PlatformAdapters } from '@core/link/adapters';

import { useSettings } from './settings';
import { UseTelemetryResult, useTelemetry } from './useTelemetry';

const TelemetryContext = createContext<UseTelemetryResult | null>(null);

export function TelemetryProvider({
  children,
  adapters,
}: {
  children: React.ReactNode;
  adapters?: PlatformAdapters;
}): React.JSX.Element {
  const { settings } = useSettings();
  const options = useMemo(
    () => ({ adapters, thresholds: settings.thresholds, geofence: settings.geofence }),
    [adapters, settings.geofence, settings.thresholds],
  );
  const telemetry = useTelemetry(options);
  return <TelemetryContext.Provider value={telemetry}>{children}</TelemetryContext.Provider>;
}

export function useTelemetryContext(): UseTelemetryResult {
  const value = useContext(TelemetryContext);
  if (value === null) throw new Error('useTelemetryContext used outside TelemetryProvider');
  return value;
}
