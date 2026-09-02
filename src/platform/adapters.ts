/**
 * Native socket adapters.
 *
 * `src/core` defines the interfaces; this file is the only place that touches
 * a native module. Each factory is behind a guarded require so the app still
 * starts in Expo Go, where none of these modules exist - it just reports that
 * the transport is unavailable instead of crashing on import.
 *
 * The packages these wrap need a development build (`npx expo prebuild` then
 * `npx expo run:android` / `run:ios`):
 *   react-native-udp          UDP datagrams
 *   react-native-tcp-socket   TCP client
 *   react-native-usb-serialport-for-android   USB OTG serial (Android only)
 */

import {
  DatagramSocket,
  PlatformAdapters,
  RemoteInfo,
  SerialPort,
  StreamSocket,
} from '@core/link/adapters';
import { Emitter, Unsubscribe } from '@core/link/types';

/** Returns the module, or null when it is not part of this build. */
function optionalRequire<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === 'string') {
    // Some native modules hand back base64. Decoding here keeps every byte
    // path above this file typed as Uint8Array.
    const binary = globalThis.atob(chunk);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  if (Array.isArray(chunk)) return Uint8Array.from(chunk as number[]);
  return new Uint8Array(0);
}

function createDatagramSocket(): DatagramSocket {
  const dgram = optionalRequire(() => require('react-native-udp').default);
  if (dgram === null) throw new Error('react-native-udp is not part of this build');

  const socket = dgram.createSocket({ type: 'udp4' });
  const messages = new Emitter<{ bytes: Uint8Array; from: RemoteInfo }>();
  const errors = new Emitter<Error>();

  socket.on('message', (data: unknown, rinfo: RemoteInfo) => {
    messages.emit({ bytes: toBytes(data), from: rinfo });
  });
  socket.on('error', (error: Error) => errors.emit(error));

  return {
    bind: (port: number) =>
      new Promise<void>((resolve) => {
        socket.bind(port, () => resolve());
      }),
    send: (bytes: Uint8Array, host: string, port: number) =>
      new Promise<void>((resolve, reject) => {
        socket.send(bytes, 0, bytes.length, port, host, (error?: Error) =>
          error ? reject(error) : resolve(),
        );
      }),
    onMessage: (listener) =>
      messages.subscribe(({ bytes, from }) => listener(bytes, from)) as Unsubscribe,
    onError: (listener) => errors.subscribe(listener),
    close: () =>
      new Promise<void>((resolve) => {
        socket.close(() => resolve());
      }),
  };
}

function createStreamSocket(): StreamSocket {
  const TcpSocket = optionalRequire(() => require('react-native-tcp-socket').default);
  if (TcpSocket === null) throw new Error('react-native-tcp-socket is not part of this build');

  const data = new Emitter<Uint8Array>();
  const closed = new Emitter<void>();
  const errors = new Emitter<Error>();
  let socket: {
    write: (bytes: Uint8Array) => void;
    destroy: () => void;
    on: (event: string, handler: (payload?: unknown) => void) => void;
  } | null = null;

  return {
    connect: (host, port, timeoutMs) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Connect to ${host}:${port} timed out`)), timeoutMs);
        socket = TcpSocket.createConnection({ host, port }, () => {
          clearTimeout(timer);
          resolve();
        });
        socket?.on('data', (chunk: unknown) => data.emit(toBytes(chunk)));
        socket?.on('close', () => closed.emit());
        socket?.on('error', (error: unknown) => {
          clearTimeout(timer);
          const wrapped = error instanceof Error ? error : new Error(String(error));
          errors.emit(wrapped);
          reject(wrapped);
        });
      }),
    write: async (bytes) => {
      socket?.write(bytes);
    },
    onData: (listener) => data.subscribe(listener),
    onClose: (listener) => closed.subscribe(() => listener()),
    onError: (listener) => errors.subscribe(listener),
    close: async () => {
      socket?.destroy();
      socket = null;
    },
  };
}

function createSerialPort(): SerialPort {
  const usbSerial = optionalRequire(() => require('react-native-usb-serialport-for-android'));
  if (usbSerial === null) throw new Error('USB serial is not part of this build');

  const data = new Emitter<Uint8Array>();
  const errors = new Emitter<Error>();
  let port: { send: (hex: string) => Promise<void>; close: () => Promise<void> } | null = null;

  return {
    list: async () => {
      const devices = await usbSerial.UsbSerialManager.list();
      return devices.map((device: { deviceId: number; vendorId: number; productId: number }) => ({
        deviceId: String(device.deviceId),
        displayName: `USB ${device.vendorId.toString(16)}:${device.productId.toString(16)}`,
        vendorId: device.vendorId,
        productId: device.productId,
      }));
    },
    open: async (deviceId, baudRate) => {
      const devices = await usbSerial.UsbSerialManager.list();
      const target =
        deviceId === undefined
          ? devices[0]
          : devices.find((device: { deviceId: number }) => String(device.deviceId) === deviceId);
      if (target === undefined) throw new Error('No matching USB serial device');
      // Android asks the user for permission the first time a device is opened.
      await usbSerial.UsbSerialManager.tryRequestPermission(target.deviceId);
      port = await usbSerial.UsbSerialManager.open(target.deviceId, { baudRate });
      return {
        deviceId: String(target.deviceId),
        displayName: `USB ${target.vendorId.toString(16)}:${target.productId.toString(16)}`,
        vendorId: target.vendorId,
        productId: target.productId,
      };
    },
    write: async (bytes) => {
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      await port?.send(hex);
    },
    onData: (listener) => data.subscribe(listener),
    onError: (listener) => errors.subscribe(listener),
    close: async () => {
      await port?.close();
      port = null;
    },
  };
}

/** The adapters this build can offer. */
export const platformAdapters: PlatformAdapters = {
  createDatagramSocket,
  createStreamSocket,
  createSerialPort,
};
