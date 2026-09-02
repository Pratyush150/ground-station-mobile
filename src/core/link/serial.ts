/**
 * Serial-over-USB telemetry link.
 *
 * This is the transport that breaks in the field. Notes that cost real time:
 *
 *  - **Enumeration is not instant.** An FTDI or CP210x adapter can take a
 *    second or more to appear after the OTG cable is plugged in, and Android
 *    asks for permission the first time. `open()` therefore retries the device
 *    list rather than failing on the first empty result.
 *  - **Baud rate must match the radio, not the autopilot.** A SiK radio at
 *    57600 in front of a flight controller set to 115200 gives a link that
 *    delivers bytes with a CRC error on every frame. If the parser reports
 *    frames arriving but all failing CRC, that is the first thing to check.
 *  - **The phone must supply bus power** for most adapters, and some phones
 *    silently refuse while charging.
 *
 * The port itself is a platform adapter; this class only owns retry, state
 * and byte forwarding.
 */

import { Scheduler, systemScheduler } from '../platform/scheduler';
import { AdapterUnavailableError, SerialDeviceInfo, SerialPort } from './adapters';
import {
  Emitter,
  LinkStatus,
  SerialLinkConfig,
  TelemetryLink,
  Unsubscribe,
  describeLink,
} from './types';

/** Baud rates offered on the Connect screen. 57600 is the SiK radio default. */
export const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 921600] as const;

export class SerialLink implements TelemetryLink {
  readonly config: SerialLinkConfig;

  private port: SerialPort | null = null;

  private readonly createPort: (() => SerialPort) | undefined;

  private subscriptions: Unsubscribe[] = [];

  private currentStatus: LinkStatus;

  private device: SerialDeviceInfo | null = null;

  private readonly bytes = new Emitter<Uint8Array>();

  private readonly statusEvents = new Emitter<LinkStatus>();

  private readonly now: () => number;

  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    config: SerialLinkConfig,
    options: {
      createPort?: () => SerialPort;
      now?: () => number;
      scheduler?: Scheduler;
    } = {},
  ) {
    this.config = config;
    this.createPort = options.createPort;
    this.now = options.now ?? (() => Date.now());
    const scheduler = options.scheduler ?? systemScheduler;
    this.sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        scheduler.setTimeout(resolve, ms);
      });
    this.currentStatus = { state: 'closed', sinceMs: this.now(), description: describeLink(config) };
  }

  get status(): LinkStatus {
    return this.currentStatus;
  }

  /** The device that was opened, once one has been. */
  get openedDevice(): SerialDeviceInfo | null {
    return this.device;
  }

  /**
   * Open the port, waiting for the adapter to enumerate.
   *
   * `attempts` and `retryDelayMs` are arguments so the test can drive the
   * retry path without waiting a real second per attempt.
   */
  async open(attempts = 5, retryDelayMs = 400): Promise<void> {
    if (this.createPort === undefined) throw new AdapterUnavailableError('serial');
    this.setStatus('opening', 'Waiting for USB device');
    const port = this.createPort();
    this.port = port;

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const devices = await port.list();
        if (devices.length === 0 && this.config.deviceId === undefined) {
          throw new Error('No serial devices enumerated yet');
        }
        this.device = await port.open(this.config.deviceId, this.config.baudRate);
        this.subscriptions.push(
          port.onData((data) => this.bytes.emit(data)),
          port.onError((error) => this.setStatus('error', 'Serial error', error.message)),
        );
        this.setStatus('open', `${this.device.displayName} @ ${this.config.baudRate}`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.setStatus('opening', `Enumerating (attempt ${attempt} of ${attempts})`, lastError.message);
        if (attempt < attempts) await this.sleep(retryDelayMs);
      }
    }

    this.setStatus('error', 'Could not open serial port', lastError?.message);
    throw lastError ?? new Error('Could not open serial port');
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    const port = this.port;
    this.port = null;
    this.device = null;
    if (port !== null) await port.close();
    this.setStatus('closed', 'Closed');
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.port === null || this.currentStatus.state !== 'open') {
      throw new Error('Serial link is not open');
    }
    await this.port.write(bytes);
  }

  onBytes(listener: (bytes: Uint8Array) => void): Unsubscribe {
    return this.bytes.subscribe(listener);
  }

  onStatus(listener: (status: LinkStatus) => void): Unsubscribe {
    return this.statusEvents.subscribe(listener);
  }

  private setStatus(state: LinkStatus['state'], description: string, error?: string): void {
    this.currentStatus = { state, sinceMs: this.now(), description, error };
    this.statusEvents.emit(this.currentStatus);
  }
}
