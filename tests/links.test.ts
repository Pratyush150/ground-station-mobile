import { describe, expect, it } from 'vitest';

import {
  AdapterUnavailableError,
  DatagramSocket,
  Emitter,
  RemoteInfo,
  SerialDeviceInfo,
  SerialPort,
  SerialLink,
  StreamSocket,
  TcpLink,
  UdpLink,
  createLink,
} from '../src/core/link';
import { Scheduler, TimerHandle } from '../src/core/platform/scheduler';

/** A scheduler whose timeouts fire straight away, so retries do not wait. */
const immediateScheduler: Scheduler = {
  setInterval: () => 0,
  clearInterval: () => undefined,
  setTimeout: (handler: () => void): TimerHandle => {
    handler();
    return 0;
  },
  clearTimeout: () => undefined,
};

function fakeDatagramSocket() {
  const messages = new Emitter<{ bytes: Uint8Array; from: RemoteInfo }>();
  const sent: { bytes: Uint8Array; host: string; port: number }[] = [];
  let boundPort: number | null = null;

  const socket: DatagramSocket = {
    bind: async (port) => {
      boundPort = port;
    },
    send: async (bytes, host, port) => {
      sent.push({ bytes, host, port });
    },
    onMessage: (listener) => messages.subscribe(({ bytes, from }) => listener(bytes, from)),
    onError: () => () => undefined,
    close: async () => {
      boundPort = null;
    },
  };

  return {
    socket,
    sent,
    deliver: (bytes: Uint8Array, from: RemoteInfo) => messages.emit({ bytes, from }),
    boundPort: () => boundPort,
  };
}

describe('UdpLink', () => {
  it('binds the configured port and forwards received bytes', async () => {
    const fake = fakeDatagramSocket();
    const link = new UdpLink({ kind: 'udp', localPort: 14550 }, { createSocket: () => fake.socket });
    const received: Uint8Array[] = [];
    link.onBytes((bytes) => received.push(bytes));

    await link.open();
    expect(fake.boundPort()).toBe(14550);
    expect(link.status.state).toBe('open');

    fake.deliver(new Uint8Array([1, 2, 3]), { address: '192.168.4.7', port: 14555 });
    expect(received).toHaveLength(1);
    expect([...received[0]]).toEqual([1, 2, 3]);
  });

  it('learns the vehicle address from the first datagram and sends back to it', async () => {
    const fake = fakeDatagramSocket();
    const link = new UdpLink({ kind: 'udp', localPort: 14550 }, { createSocket: () => fake.socket });
    await link.open();

    // Nothing received yet: there is nowhere to send, and saying so beats
    // sending to a guessed address.
    await expect(link.send(new Uint8Array([9]))).rejects.toThrow(/No vehicle address/);

    fake.deliver(new Uint8Array([1]), { address: '192.168.4.7', port: 14555 });
    expect(link.learnedRemote).toEqual({ address: '192.168.4.7', port: 14555 });

    await link.send(new Uint8Array([9]));
    expect(fake.sent[0].host).toBe('192.168.4.7');
    expect(fake.sent[0].port).toBe(14555);
  });

  it('refuses to send while closed and stops forwarding after close', async () => {
    const fake = fakeDatagramSocket();
    const link = new UdpLink({ kind: 'udp', localPort: 14550 }, { createSocket: () => fake.socket });
    await expect(link.send(new Uint8Array([1]))).rejects.toThrow(/not open/);

    const received: Uint8Array[] = [];
    link.onBytes((bytes) => received.push(bytes));
    await link.open();
    await link.close();
    fake.deliver(new Uint8Array([1]), { address: '10.0.0.1', port: 1 });
    expect(received).toHaveLength(0);
    expect(link.status.state).toBe('closed');
  });

  it('reports a missing native module instead of crashing', async () => {
    const link = new UdpLink({ kind: 'udp', localPort: 14550 });
    await expect(link.open()).rejects.toBeInstanceOf(AdapterUnavailableError);
  });
});

describe('TcpLink', () => {
  it('connects, forwards data, and reports a peer-side close', async () => {
    const data = new Emitter<Uint8Array>();
    const closed = new Emitter<void>();
    const socket: StreamSocket = {
      connect: async () => undefined,
      write: async () => undefined,
      onData: (listener) => data.subscribe(listener),
      onClose: (listener) => closed.subscribe(() => listener()),
      onError: () => () => undefined,
      close: async () => undefined,
    };

    const link = new TcpLink({ kind: 'tcp', host: '127.0.0.1', port: 5760 }, { createSocket: () => socket });
    const received: Uint8Array[] = [];
    link.onBytes((bytes) => received.push(bytes));

    await link.open();
    expect(link.status.state).toBe('open');
    data.emit(new Uint8Array([0xfe, 0x09]));
    expect(received).toHaveLength(1);

    closed.emit();
    expect(link.status.state).toBe('closed');
    expect(link.status.description).toMatch(/Peer closed/);
  });

  it('surfaces a failed connect as an error status', async () => {
    const socket: StreamSocket = {
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
      write: async () => undefined,
      onData: () => () => undefined,
      onClose: () => () => undefined,
      onError: () => () => undefined,
      close: async () => undefined,
    };
    const link = new TcpLink({ kind: 'tcp', host: '10.0.0.9', port: 5760 }, { createSocket: () => socket });
    await expect(link.open()).rejects.toThrow('ECONNREFUSED');
    expect(link.status.state).toBe('error');
    expect(link.status.error).toBe('ECONNREFUSED');
  });
});

describe('SerialLink', () => {
  /** A port that only enumerates after `appearAfter` list() calls. */
  function fakePort(appearAfter: number) {
    let listCalls = 0;
    const device: SerialDeviceInfo = { deviceId: '1', displayName: 'FTDI FT232' };
    const port: SerialPort = {
      list: async () => {
        listCalls += 1;
        return listCalls > appearAfter ? [device] : [];
      },
      open: async () => device,
      write: async () => undefined,
      onData: () => () => undefined,
      onError: () => () => undefined,
      close: async () => undefined,
    };
    return { port, listCalls: () => listCalls };
  }

  it('retries while the USB adapter is still enumerating', async () => {
    const fake = fakePort(2); // appears on the third attempt
    const link = new SerialLink(
      { kind: 'serial', baudRate: 57600 },
      { createPort: () => fake.port, scheduler: immediateScheduler },
    );
    await link.open(5, 1);
    expect(link.status.state).toBe('open');
    expect(link.openedDevice?.displayName).toBe('FTDI FT232');
    expect(fake.listCalls()).toBe(3);
  });

  it('gives up with a useful error when nothing ever enumerates', async () => {
    const fake = fakePort(99);
    const link = new SerialLink(
      { kind: 'serial', baudRate: 57600 },
      { createPort: () => fake.port, scheduler: immediateScheduler },
    );
    await expect(link.open(3, 1)).rejects.toThrow(/enumerated/);
    expect(link.status.state).toBe('error');
    expect(fake.listCalls()).toBe(3);
  });
});

describe('createLink', () => {
  it('builds the link named by the config', () => {
    expect(createLink({ kind: 'demo', seed: 1 })).toBeDefined();
    expect(createLink({ kind: 'udp', localPort: 14550 })).toBeInstanceOf(UdpLink);
    expect(createLink({ kind: 'tcp', host: 'localhost', port: 5760 })).toBeInstanceOf(TcpLink);
    expect(createLink({ kind: 'serial', baudRate: 57600 })).toBeInstanceOf(SerialLink);
  });
});
