/**
 * Settings: units, alert thresholds, geofence and screen behaviour.
 *
 * Thresholds are exposed because a 3S racing quad and a 12S survey aircraft do
 * not want the same low-battery number. What is not exposed is the hysteresis
 * shape: an alert that can be configured to chatter will be.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { UNIT_PRESETS, UnitPresetName } from '@core/units';
import { useSettings } from '@hooks/settings';
import { TOUCH_TARGET, colors, spacing, typography } from '@theme/index';

const PRESET_LABELS: Record<UnitPresetName, string> = {
  metric: 'Metric (m, m/s)',
  imperial: 'Imperial (ft, mph)',
  aviation: 'Aviation (ft, kt)',
};

export function SettingsScreen(): React.JSX.Element {
  const { settings, setUnitPreset, setThresholds, setKeepAwake } = useSettings();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.section}>UNITS</Text>
      {(Object.keys(UNIT_PRESETS) as UnitPresetName[]).map((preset) => (
        <Pressable
          key={preset}
          onPress={() => setUnitPreset(preset)}
          style={[styles.row, settings.unitPreset === preset && styles.rowActive]}
          accessibilityRole="radio"
          accessibilityState={{ selected: settings.unitPreset === preset }}
        >
          <Text style={styles.rowLabel}>{PRESET_LABELS[preset]}</Text>
          {settings.unitPreset === preset ? <Text style={styles.tick}>selected</Text> : null}
        </Pressable>
      ))}

      <Text style={styles.section}>BATTERY ALERTS</Text>
      <Stepper
        label="Low battery"
        value={settings.thresholds.batteryLowPct}
        unit="%"
        onChange={(value) =>
          setThresholds({
            ...settings.thresholds,
            batteryLowPct: value,
            // The clear threshold is kept above the trigger so the alert can
            // never be configured into a chattering state.
            batteryLowClearPct: value + 5,
          })
        }
      />
      <Stepper
        label="Critical battery"
        value={settings.thresholds.batteryCriticalPct}
        unit="%"
        onChange={(value) =>
          setThresholds({
            ...settings.thresholds,
            batteryCriticalPct: value,
            batteryCriticalClearPct: value + 5,
          })
        }
      />

      <Text style={styles.section}>LINK</Text>
      <Stepper
        label="Link loss after"
        value={settings.thresholds.linkLossMs / 1000}
        unit="s"
        step={1}
        onChange={(value) =>
          setThresholds({
            ...settings.thresholds,
            linkLossMs: value * 1000,
            linkRecoveredMs: Math.max(500, (value * 1000) / 2),
          })
        }
      />

      <Text style={styles.section}>DISPLAY</Text>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Keep screen awake while connected</Text>
        <Switch value={settings.keepAwake} onValueChange={setKeepAwake} />
      </View>

      <Text style={styles.footnote}>
        Thresholds are advisory and live on the phone. They do not change anything on the aircraft:
        the autopilot&apos;s own failsafes are the authority.
      </Text>
    </ScrollView>
  );
}

function Stepper({
  label,
  value,
  unit,
  step = 5,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step?: number;
  onChange: (next: number) => void;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepButton} onPress={() => onChange(Math.max(step, value - step))}>
          <Text style={styles.stepLabel}>-</Text>
        </Pressable>
        <Text style={styles.stepValue}>
          {value} {unit}
        </Text>
        <Pressable style={styles.stepButton} onPress={() => onChange(value + step)}>
          <Text style={styles.stepLabel}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm },
  section: { ...typography.label, color: colors.textMuted, marginTop: spacing.lg },
  row: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  rowActive: { borderWidth: 1, borderColor: colors.accent },
  rowLabel: { ...typography.body, color: colors.text, flexShrink: 1 },
  tick: { ...typography.label, color: colors.accent },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: { ...typography.readoutSmall, color: colors.text },
  stepValue: { ...typography.mono, color: colors.text, minWidth: 56, textAlign: 'center' },
  footnote: { ...typography.body, color: colors.textDisabled, marginTop: spacing.lg },
});

export default SettingsScreen;
