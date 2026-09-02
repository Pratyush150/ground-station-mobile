/**
 * Platform adapter interfaces.
 *
 * `src/core` cannot import React Native, so the real sockets are injected.
 * Each interface is the smallest surface the link needs, which keeps the
 * native shim thin and makes a fake socket in a test three lines long.
 *
 * The concrete adapters live in `src/platform` and wrap:
 *   UDP    - react-native-udp
 *   TCP    - react-native-tcp-socket
 *   Serial - react-native-usb-serialport (Android) / ExpoUsbSerial (custom)
 *
 * All three need a development build. They are not available in Expo Go,
 * which is why the demo link exists and why the README says so plainly.
 */

import { Unsubscribe } from './types';

/** Where a datagram came from. Used to learn the vehicle's address. */
export interface RemoteInfo {
  address: string;
  port: number;
}

export interface DatagramSocket {
  bind(port: number): Promise<void>;
  send(bytes: Uint8Array, host: string, port: number): Promise<void>;
  onMessage(listener: (bytes: Uint8Array, from: RemoteInfo) => void): Unsubscribe;
  onError(listener: (error: Error) => void): Unsubscribe;
  close(): Promise<void>;
}

export interface StreamSocket {
  connect(host: string, port: number, timeoutMs: number): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  onData(listener: (bytes: Uint8Array) => void): Unsubscribe;
  onClose(listener: () => void): Unsubscribe;
  onError(listener: (error: Error) => void): Unsubscribe;
  close(): Promise<void>;
}

/** A serial device the OS has enumerated. */
export interface SerialDeviceInfo {
  deviceId: string;
  displayName: string;
  vendorId?: number;
  productId?: number;
}

export interface SerialPort {
  list(): Promise<SerialDeviceInfo[]>;
  open(deviceId: string | undefined, baudRate: number): Promise<SerialDeviceInfo>;
  write(bytes: Uint8Array): Promise<void>;
  onData(listener: (bytes: Uint8Array) => void): Unsubscribe;
  onError(listener: (error: Error) => void): Unsubscribe;
  close(): Promise<void>;
}

/** Factories the app registers once at startup. */
export interface PlatformAdapters {
  createDatagramSocket?: () => DatagramSocket;
  createStreamSocket?: () => StreamSocket;
  createSerialPort?: () => SerialPort;
}

/** Thrown when a link is used on a platform whose adapter was not registered. */
export class AdapterUnavailableError extends Error {
  constructor(kind: string) {
    super(
      `No ${kind} adapter registered. This transport needs a development build; ` +
        'use the demo link in Expo Go.',
    );
    this.name = 'AdapterUnavailableError';
  }
}
