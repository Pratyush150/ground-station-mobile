/**
 * Link construction.
 *
 * One place that turns a config into a link, so the Connect screen does not
 * grow a switch statement and the adapters are injected in exactly one spot.
 */

import { Scheduler } from '../platform/scheduler';
import { PlatformAdapters } from './adapters';
import { DemoLink } from './demo';
import { TcpLink, UdpLink } from './network';
import { SerialLink } from './serial';
import { LinkConfig, TelemetryLink } from './types';

/** Build the link described by `config`, wiring in the platform adapters. */
export function createLink(
  config: LinkConfig,
  adapters: PlatformAdapters = {},
  options: { scheduler?: Scheduler } = {},
): TelemetryLink {
  switch (config.kind) {
    case 'demo':
      return new DemoLink(config, { scheduler: options.scheduler });
    case 'udp':
      return new UdpLink(config, { createSocket: adapters.createDatagramSocket });
    case 'tcp':
      return new TcpLink(config, { createSocket: adapters.createStreamSocket });
    case 'serial':
      return new SerialLink(config, {
        createPort: adapters.createSerialPort,
        scheduler: options.scheduler,
      });
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported link config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Defaults offered on the Connect screen. */
export const DEFAULT_LINK_CONFIGS: LinkConfig[] = [
  { kind: 'demo', seed: 1337 },
  { kind: 'udp', localPort: 14550 },
  { kind: 'tcp', host: '127.0.0.1', port: 5760 },
  { kind: 'serial', baudRate: 57600 },
];
