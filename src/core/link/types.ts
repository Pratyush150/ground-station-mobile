/**
 * Transport abstraction.
 *
 * Every link is "a source of bytes that may stop". The parser above it does
 * not care whether those bytes came from a UDP socket, a USB serial adapter
 * or the demo generator, which is what lets the whole telemetry pipeline be
 * tested without hardware.
 */

/** Transport kinds the app offers on the Connect screen. */
export type LinkKind = 'udp' | 'tcp' | 'serial' | 'demo';

/** Listen for MAVLink over UDP. The usual setup for a WiFi telemetry bridge. */
export interface UdpLinkConfig {
  kind: 'udp';
  /** Port to bind locally. 14550 is the conventional GCS port. */
  localPort: number;
  /**
   * Where to send uplink. Usually left undefined: the vehicle's address is
   * learned from the first datagram, which is what makes DHCP setups work.
   */
  remoteHost?: string;
  remotePort?: number;
}

/** Connect to a MAVLink TCP server, e.g. SITL or mavlink-router. */
export interface TcpLinkConfig {
  kind: 'tcp';
  host: string;
  port: number;
  connectTimeoutMs?: number;
}

/** USB or Bluetooth serial to a telemetry radio. */
export interface SerialLinkConfig {
  kind: 'serial';
  /** Platform device identifier. Enumerated at connect time. */
  deviceId?: string;
  baudRate: number;
}

/** Deterministic synthetic flight, so the app is usable with no aircraft. */
export interface DemoLinkConfig {
  kind: 'demo';
  seed: number;
  faults?: DemoFaults;
}

/** Faults the demo link can inject, to exercise the alert paths on a desk. */
export interface DemoFaults {
  /** Seconds into the flight at which telemetry stops. */
  linkDropoutAtS?: number;
  linkDropoutDurationS?: number;
  /** Corrupt one byte of every Nth frame, so the CRC rejects it. */
  corruptEveryNthFrame?: number;
  /** Seconds at which the GPS drops to a 2D fix with few satellites. */
  gpsDegradeAtS?: number;
  gpsDegradeDurationS?: number;
  /** Multiply the battery drain rate. 3 gets to a low-battery alert quickly. */
  batteryDrainMultiplier?: number;
}

export type LinkConfig = UdpLinkConfig | TcpLinkConfig | SerialLinkConfig | DemoLinkConfig;

export type LinkState = 'closed' | 'opening' | 'open' | 'error';

export interface LinkStatus {
  state: LinkState;
  /** Wall-clock milliseconds when the state was entered. */
  sinceMs: number;
  /** Human-readable description for the Connect screen. */
  description: string;
  error?: string;
}

export type Unsubscribe = () => void;

/**
 * A telemetry transport.
 *
 * Implementations must never throw from a listener callback path and must be
 * safe to `close()` twice: a mobile app gets backgrounded mid-connect more
 * often than anything else.
 */
export interface TelemetryLink {
  readonly config: LinkConfig;
  readonly status: LinkStatus;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Send bytes upstream. Rejects if the link is not open. */
  send(bytes: Uint8Array): Promise<void>;
  /** Subscribe to raw inbound bytes. Returns an unsubscribe function. */
  onBytes(listener: (bytes: Uint8Array) => void): Unsubscribe;
  onStatus(listener: (status: LinkStatus) => void): Unsubscribe;
}

/** Minimal synchronous event emitter. Avoids a dependency for four lines. */
export class Emitter<T> {
  private listeners: Array<(value: T) => void> = [];

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    };
  }

  emit(value: T): void {
    // Iterate over a copy so a listener may unsubscribe during dispatch.
    for (const listener of [...this.listeners]) listener(value);
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

/** Short label for the Connect screen. */
export function describeLink(config: LinkConfig): string {
  switch (config.kind) {
    case 'udp':
      return `UDP :${config.localPort}`;
    case 'tcp':
      return `TCP ${config.host}:${config.port}`;
    case 'serial':
      return `Serial ${config.deviceId ?? 'auto'} @ ${config.baudRate}`;
    case 'demo':
      return `Demo flight (seed ${config.seed})`;
    default:
      return 'Unknown link';
  }
}
