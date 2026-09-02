/**
 * User settings: units, alert thresholds and the geofence.
 *
 * Persisted with AsyncStorage so a phone that gets killed in the background
 * comes back with the same configuration. Loading is asynchronous, so the
 * provider renders children with defaults until the stored values arrive
 * rather than blocking the first paint.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { AlertThresholds, DEFAULT_THRESHOLDS } from '@core/alerts';
import { Geofence } from '@core/geo';
import { UNIT_PRESETS, UnitPreferences, UnitPresetName } from '@core/units';

const STORAGE_KEY = 'ground-station.settings.v1';

export interface Settings {
  unitPreset: UnitPresetName;
  units: UnitPreferences;
  thresholds: AlertThresholds;
  geofence: Geofence | null;
  /** Keep the screen awake while a link is open. */
  keepAwake: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  unitPreset: 'metric',
  units: UNIT_PRESETS.metric,
  thresholds: DEFAULT_THRESHOLDS,
  geofence: null,
  keepAwake: true,
};

interface SettingsContextValue {
  settings: Settings;
  setUnitPreset: (preset: UnitPresetName) => void;
  setThresholds: (thresholds: AlertThresholds) => void;
  setGeofence: (geofence: Geofence | null) => void;
  setKeepAwake: (keepAwake: boolean) => void;
  loaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  setUnitPreset: () => undefined,
  setThresholds: () => undefined,
  setGeofence: () => undefined,
  setKeepAwake: () => undefined,
  loaded: false,
});

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || raw === null) return;
        const stored = JSON.parse(raw) as Partial<Settings>;
        setSettings((current) => ({ ...current, ...stored }));
      })
      .catch(() => {
        // A corrupt settings blob must not stop the app from starting: the
        // defaults are always flyable.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: Settings) => {
    setSettings(next);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      loaded,
      setUnitPreset: (preset) =>
        persist({ ...settings, unitPreset: preset, units: UNIT_PRESETS[preset] }),
      setThresholds: (thresholds) => persist({ ...settings, thresholds }),
      setGeofence: (geofence) => persist({ ...settings, geofence }),
      setKeepAwake: (keepAwake) => persist({ ...settings, keepAwake }),
    }),
    [loaded, persist, settings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
