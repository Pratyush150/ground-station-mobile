/**
 * UDP and TCP telemetry links.
 *
 * Both are thin: they own connection state and hand raw bytes to the parser.
 * Neither knows anything about MAVLink, which is the point - a link that
 * parses is a link you cannot test independently of the parser.
 */

import {
  AdapterUnavailableError,
  DatagramSocket,
  RemoteInfo,
  StreamSocket,
} from './adapters';
import {
  Emitter,
  LinkStatus,
  TcpLinkConfig,
  TelemetryLink,
  UdpLinkConfig,
  Unsubscribe,
  describeLink,
} from './types';

/**
 * MAVLink over UDP.
 *
 * The vehicle's address is learned from the first datagram rather than being
 * configured. On a field WiFi network the aircraft's IP comes from DHCP and
 * changes between sessions; making the operator type it in is a good way to
 * lose ten minutes at the launch point.
 */
export class UdpLink implements TelemetryLink {
  readonly config: UdpLinkConfig;

  private socket: DatagramSocket | null = null;

  private readonly createSocket: (() => DatagramSocket) | undefined;

  private remote: RemoteInfo | null = null;

  private subscriptions: Unsubscribe[] = [];

  private currentStatus: LinkStatus;

  private readonly bytes = new Emitter<Uint8Array>();

  private readonly statusEvents = new Emitter<LinkStatus>();

  private readonly now: () => number;

  constructor(
    config: UdpLinkConfig,
    options: { createSocket?: () => DatagramSocket; now?: () => number } = {},
  ) {
    this.config = config;
    this.createSocket = options.createSocket;
    this.now = options.now ?? (() => Date.now());
    this.currentStatus = { state: 'closed', sinceMs: this.now(), description: describeLink(config) };
  }

  get status(): LinkStatus {
    return this.currentStatus;
  }

  /** The address the last datagram came from, once one has arrived. */
  get learnedRemote(): RemoteInfo | null {
    return this.remote;
  }

  async open(): Promise<void> {
    if (this.createSocket === undefined) throw new AdapterUnavailableError('UDP');
    this.setStatus('opening', `Binding UDP :${this.config.localPort}`);
    const socket = this.createSocket();
    this.socket = socket;

    this.subscriptions.push(
      socket.onMessage((data, from) => {
        if (this.remote === null) this.remote = from;
        this.bytes.emit(data);
      }),
      socket.onError((error) => this.fail(error)),
    );

    try {
      await socket.bind(this.config.localPort);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    if (this.config.remoteHost !== undefined && this.config.remotePort !== undefined) {
      this.remote = { address: this.config.remoteHost, port: this.config.remotePort };
    }
    this.setStatus('open', describeLink(this.config));
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    const socket = this.socket;
    this.socket = null;
    this.remote = null;
    if (socket !== null) await socket.close();
    this.setStatus('closed', 'Closed');
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.socket === null || this.currentStatus.state !== 'open') {
      throw new Error('UDP link is not open');
    }
    if (this.remote === null) {
      throw new Error('No vehicle address yet: nothing has been received on this port');
    }
    await this.socket.send(bytes, this.remote.address, this.remote.port);
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

  private fail(error: Error): void {
    this.setStatus('error', 'UDP error', error.message);
  }
}

/**
 * MAVLink over TCP, for SITL and for mavlink-router endpoints.
 *
 * TCP delivers a byte stream with no message boundaries, so a frame routinely
 * arrives in two pieces. That is handled upstream by `FrameParser`; this class
 * must not try to be clever about it.
 */
export class TcpLink implements TelemetryLink {
  readonly config: TcpLinkConfig;

  private socket: StreamSocket | null = null;

  private readonly createSocket: (() => StreamSocket) | undefined;

  private subscriptions: Unsubscribe[] = [];

  private currentStatus: LinkStatus;

  private readonly bytes = new Emitter<Uint8Array>();

  private readonly statusEvents = new Emitter<LinkStatus>();

  private readonly now: () => number;

  constructor(
    config: TcpLinkConfig,
    options: { createSocket?: () => StreamSocket; now?: () => number } = {},
  ) {
    this.config = config;
    this.createSocket = options.createSocket;
    this.now = options.now ?? (() => Date.now());
    this.currentStatus = { state: 'closed', sinceMs: this.now(), description: describeLink(config) };
  }

  get status(): LinkStatus {
    return this.currentStatus;
  }

  async open(): Promise<void> {
    if (this.createSocket === undefined) throw new AdapterUnavailableError('TCP');
    this.setStatus('opening', `Connecting to ${this.config.host}:${this.config.port}`);
    const socket = this.createSocket();
    this.socket = socket;

    this.subscriptions.push(
      socket.onData((data) => this.bytes.emit(data)),
      socket.onError((error) => this.setStatus('error', 'TCP error', error.message)),
      socket.onClose(() => this.setStatus('closed', 'Peer closed the connection')),
    );

    try {
      await socket.connect(this.config.host, this.config.port, this.config.connectTimeoutMs ?? 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', 'Connect failed', message);
      throw error;
    }
    this.setStatus('open', describeLink(this.config));
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) await socket.close();
    this.setStatus('closed', 'Closed');
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.socket === null || this.currentStatus.state !== 'open') {
      throw new Error('TCP link is not open');
    }
    await this.socket.write(bytes);
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
