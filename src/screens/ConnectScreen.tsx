/**
 * Connect screen: pick a transport and open it.
 *
 * Demo is first and is the default, because the app has to do something
 * useful before anyone has powered an aircraft, and because a support
 * conversation that starts "open demo mode and send me a screenshot" is much
 * shorter than one that starts "what is your radio configuration".
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LinkIndicator } from '@components/index';
import { COMMON_BAUD_RATES, LinkConfig, LinkKind } from '@core/link';
import { useTelemetryContext } from '@hooks/telemetryContext';
import { TOUCH_TARGET, colors, spacing, typography } from '@theme/index';

const KIND_LABELS: Record<LinkKind, string> = {
  demo: 'Demo flight',
  udp: 'UDP',
  tcp: 'TCP',
  serial: 'USB serial',
};

const KIND_NOTES: Record<LinkKind, string> = {
  demo: 'A deterministic simulated flight. No hardware, no network.',
  udp: 'Binds a local port and learns the vehicle address from the first packet.',
  tcp: 'Connects out to SITL or a mavlink-router endpoint.',
  serial: 'Telemetry radio over USB OTG. Baud must match the radio, not the autopilot.',
};

export function ConnectScreen(): React.JSX.Element {
  const { connect, disconnect, connected, snapshot, error } = useTelemetryContext();
  const [kind, setKind] = useState<LinkKind>('demo');
  const [udpPort, setUdpPort] = useState('14550');
  const [tcpHost, setTcpHost] = useState('127.0.0.1');
  const [tcpPort, setTcpPort] = useState('5760');
  const [baudRate, setBaudRate] = useState(57600);
  const [busy, setBusy] = useState(false);

  const buildConfig = (): LinkConfig => {
    switch (kind) {
      case 'udp':
        return { kind: 'udp', localPort: Number(udpPort) || 14550 };
      case 'tcp':
        return { kind: 'tcp', host: tcpHost, port: Number(tcpPort) || 5760 };
      case 'serial':
        return { kind: 'serial', baudRate };
      default:
        return { kind: 'demo', seed: 1337 };
    }
  };

  const onPress = async () => {
    setBusy(true);
    try {
      if (connected) await disconnect();
      else await connect(buildConfig());
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Link</Text>

      <View style={styles.kindRow}>
        {(Object.keys(KIND_LABELS) as LinkKind[]).map((option) => (
          <Pressable
            key={option}
            onPress={() => setKind(option)}
            style={[styles.kindButton, kind === option && styles.kindButtonActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === option }}
          >
            <Text style={[styles.kindLabel, kind === option && styles.kindLabelActive]}>
              {KIND_LABELS[option]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>{KIND_NOTES[kind]}</Text>

      {kind === 'udp' ? (
        <Field label="LOCAL PORT" value={udpPort} onChange={setUdpPort} keyboardType="number-pad" />
      ) : null}

      {kind === 'tcp' ? (
        <>
          <Field label="HOST" value={tcpHost} onChange={setTcpHost} />
          <Field label="PORT" value={tcpPort} onChange={setTcpPort} keyboardType="number-pad" />
        </>
      ) : null}

      {kind === 'serial' ? (
        <View style={styles.baudRow}>
          {COMMON_BAUD_RATES.map((rate) => (
            <Pressable
              key={rate}
              onPress={() => setBaudRate(rate)}
              style={[styles.baudButton, baudRate === rate && styles.kindButtonActive]}
            >
              <Text style={[styles.kindLabel, baudRate === rate && styles.kindLabelActive]}>{rate}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={onPress}
        disabled={busy}
        style={[styles.primaryButton, connected && styles.disconnectButton]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryLabel}>{connected ? 'Disconnect' : 'Connect'}</Text>
      </Pressable>

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}

      {snapshot !== null ? (
        <LinkIndicator
          status={snapshot.linkStatus}
          stats={snapshot.vehicle.link}
          ageMs={snapshot.linkAgeMs}
        />
      ) : null}

      <Text style={styles.footnote}>
        UDP, TCP and USB serial need a development build: the native socket modules are not part of
        Expo Go. Demo mode works everywhere.
      </Text>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  keyboardType?: 'number-pad';
}): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        style={styles.input}
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { ...typography.readoutSmall, color: colors.text },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindButton: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindButtonActive: { backgroundColor: colors.surfaceRaised, borderColor: colors.accent },
  kindLabel: { ...typography.body, color: colors.textMuted },
  kindLabelActive: { color: colors.text, fontWeight: '700' },
  note: { ...typography.body, color: colors.textMuted },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.label, color: colors.textMuted },
  input: {
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 18,
  },
  baudRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  baudButton: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primaryButton: {
    minHeight: TOUCH_TARGET,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disconnectButton: { backgroundColor: colors.critical },
  primaryLabel: { ...typography.readoutSmall, color: colors.background },
  error: { ...typography.body, color: colors.critical },
  footnote: { ...typography.body, color: colors.textDisabled },
});

export default ConnectScreen;
