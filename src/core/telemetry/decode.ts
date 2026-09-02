/**
 * MAVLink frame decoding: streaming parser, CRC validation, sequence-gap
 * accounting and payload extraction.
 *
 * The three things that break real ground stations are handled here:
 *
 *  1. **Frames split across reads.** A UDP datagram usually holds whole
 *     frames; a TCP socket or a USB serial port does not. `FrameParser` keeps
 *     a residual buffer so a frame delivered as "first 9 bytes now, rest in
 *     40 ms" decodes exactly once, when it is complete.
 *  2. **Garbage in the stream.** Boot messages from a radio, a half-frame left
 *     over from a previous session, or line noise. The parser resyncs by
 *     dropping one byte and rescanning for a start marker, and counts what it
 *     threw away so the link screen can show it.
 *  3. **Silent corruption.** A frame whose CRC does not match is dropped, not
 *     "best effort" decoded. CRC_EXTRA means a mismatched message definition
 *     is rejected too, rather than misread into plausible-looking numbers.
 *
 * Both MAVLink v1 (0xFE) and v2 (0xFD) framing are supported, including v2
 * payload truncation, where trailing zero bytes are removed by the sender and
 * must be zero-extended by the receiver before fields are read.
 */

import { ByteReader, ByteWriter, crc16Mcrf4xx } from './binary';

/** MAVLink v1 start-of-frame marker. */
export const MAVLINK_V1_STX = 0xfe;
/** MAVLink v2 start-of-frame marker. */
export const MAVLINK_V2_STX = 0xfd;

/** v2 incompat flag: the frame carries a 13-byte signature after the CRC. */
const MAVLINK_IFLAG_SIGNED = 0x01;
const V2_SIGNATURE_LENGTH = 13;

/** Message IDs this parser understands. */
export enum MessageId {
  Heartbeat = 0,
  SysStatus = 1,
  GpsRawInt = 24,
  Attitude = 30,
  GlobalPositionInt = 33,
  MissionCurrent = 42,
  MissionItemReached = 46,
  VfrHud = 74,
  Statustext = 253,
  BatteryStatus = 147,
}

/**
 * CRC_EXTRA per message, from the MAVLink `common.xml` dialect.
 *
 * CRC_EXTRA is a hash over the message's field names and types. It is folded
 * into the checksum so that two peers built against different dialect versions
 * fail loudly instead of decoding each other's bytes into the wrong fields.
 * If you fly a custom dialect, regenerate this table with mavgen rather than
 * editing it by hand.
 */
export const CRC_EXTRA: Readonly<Record<number, number>> = {
  [MessageId.Heartbeat]: 50,
  [MessageId.SysStatus]: 124,
  [MessageId.GpsRawInt]: 24,
  [MessageId.Attitude]: 39,
  [MessageId.GlobalPositionInt]: 104,
  [MessageId.MissionCurrent]: 28,
  [MessageId.MissionItemReached]: 11,
  [MessageId.VfrHud]: 20,
  [MessageId.BatteryStatus]: 154,
  [MessageId.Statustext]: 83,
};

/** Un-truncated payload length per message, used to zero-extend v2 payloads. */
export const PAYLOAD_LENGTH: Readonly<Record<number, number>> = {
  [MessageId.Heartbeat]: 9,
  [MessageId.SysStatus]: 31,
  [MessageId.GpsRawInt]: 30,
  [MessageId.Attitude]: 28,
  [MessageId.GlobalPositionInt]: 28,
  [MessageId.MissionCurrent]: 2,
  [MessageId.MissionItemReached]: 2,
  [MessageId.VfrHud]: 20,
  [MessageId.BatteryStatus]: 36,
  [MessageId.Statustext]: 51,
};

/** A validated frame lifted off the wire. */
export interface MavlinkFrame {
  /** 1 for 0xFE framing, 2 for 0xFD framing. */
  version: 1 | 2;
  sequence: number;
  systemId: number;
  componentId: number;
  messageId: number;
  /** Payload exactly as received (may be truncated on v2). */
  payload: Uint8Array;
  checksum: number;
  /** Total wire length of the frame, including markers and checksum. */
  wireLength: number;
}

/** Why the parser threw bytes away. Surfaced on the link diagnostics screen. */
export interface ParserStats {
  framesDecoded: number;
  crcErrors: number;
  /** Frames the sequence numbers prove we never received. */
  framesLost: number;
  /** Bytes discarded during resync, including bytes of rejected frames. */
  bytesDropped: number;
  /** Frames with a message ID that is not in the CRC_EXTRA table. */
  unknownMessages: number;
}

const MAX_BUFFER_BYTES = 8192;

/**
 * Streaming MAVLink frame parser.
 *
 * Feed it whatever the transport hands you, in whatever sized chunks it comes
 * in. It returns the frames that are complete and valid, and keeps the rest.
 */
export class FrameParser {
  private buffer = new Uint8Array(0);

  private readonly lastSequence = new Map<number, number>();

  readonly stats: ParserStats = {
    framesDecoded: 0,
    crcErrors: 0,
    framesLost: 0,
    bytesDropped: 0,
    unknownMessages: 0,
  };

  /** Bytes currently held back waiting for the rest of a frame. */
  get pendingBytes(): number {
    return this.buffer.length;
  }

  /** Drop the residual buffer and sequence history. Call on reconnect. */
  reset(): void {
    this.buffer = new Uint8Array(0);
    this.lastSequence.clear();
  }

  /**
   * Consume a chunk of transport bytes and return every frame that completed.
   *
   * Never throws on malformed input: bad bytes are counted and dropped.
   */
  push(chunk: Uint8Array): MavlinkFrame[] {
    if (chunk.length > 0) {
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer, 0);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
    }

    // A stream of pure garbage must not grow the buffer without bound.
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      const excess = this.buffer.length - MAX_BUFFER_BYTES;
      this.stats.bytesDropped += excess;
      this.buffer = this.buffer.slice(excess);
    }

    const frames: MavlinkFrame[] = [];
    let cursor = 0;

    for (;;) {
      const start = this.findStart(cursor);
      if (start < 0) {
        // Nothing that could begin a frame: drop everything scanned so far.
        this.stats.bytesDropped += this.buffer.length - cursor;
        cursor = this.buffer.length;
        break;
      }
      if (start > cursor) {
        this.stats.bytesDropped += start - cursor;
        cursor = start;
      }

      const attempt = this.tryFrameAt(cursor);
      if (attempt === 'incomplete') break;
      if (attempt === 'invalid') {
        // Resync one byte at a time: the real start marker may be inside what
        // we assumed was a frame.
        this.stats.bytesDropped += 1;
        cursor += 1;
        continue;
      }
      frames.push(attempt);
      this.stats.framesDecoded += 1;
      this.accountSequence(attempt);
      cursor += attempt.wireLength;
    }

    this.buffer = cursor === 0 ? this.buffer : this.buffer.slice(cursor);
    return frames;
  }

  private findStart(from: number): number {
    for (let i = from; i < this.buffer.length; i += 1) {
      const byte = this.buffer[i];
      if (byte === MAVLINK_V1_STX || byte === MAVLINK_V2_STX) return i;
    }
    return -1;
  }

  private tryFrameAt(at: number): MavlinkFrame | 'incomplete' | 'invalid' {
    const buf = this.buffer;
    const marker = buf[at];
    const headerLength = marker === MAVLINK_V2_STX ? 10 : 6;
    if (buf.length - at < headerLength) return 'incomplete';

    const payloadLength = buf[at + 1];
    let messageId: number;
    let sequence: number;
    let systemId: number;
    let componentId: number;
    let signatureLength = 0;

    if (marker === MAVLINK_V2_STX) {
      const incompatFlags = buf[at + 2];
      sequence = buf[at + 4];
      systemId = buf[at + 5];
      componentId = buf[at + 6];
      messageId = buf[at + 7] | (buf[at + 8] << 8) | (buf[at + 9] << 16);
      signatureLength = incompatFlags & MAVLINK_IFLAG_SIGNED ? V2_SIGNATURE_LENGTH : 0;
    } else {
      sequence = buf[at + 2];
      systemId = buf[at + 3];
      componentId = buf[at + 4];
      messageId = buf[at + 5];
    }

    const wireLength = headerLength + payloadLength + 2 + signatureLength;
    if (buf.length - at < wireLength) return 'incomplete';

    const crcExtra = CRC_EXTRA[messageId];
    if (crcExtra === undefined) {
      // Without the message definition the checksum cannot be verified, so the
      // frame is skipped rather than trusted. Length fields are still used to
      // step over it, which keeps the stream in sync for messages we do know.
      this.stats.unknownMessages += 1;
      return 'invalid';
    }

    const checksumStart = at + headerLength + payloadLength;
    const received = buf[checksumStart] | (buf[checksumStart + 1] << 8);
    const covered = buf.subarray(at + 1, checksumStart);
    const computed = crc16Mcrf4xx(new Uint8Array([...covered, crcExtra]));
    if (computed !== received) {
      this.stats.crcErrors += 1;
      return 'invalid';
    }

    return {
      version: marker === MAVLINK_V2_STX ? 2 : 1,
      sequence,
      systemId,
      componentId,
      messageId,
      payload: buf.slice(at + headerLength, checksumStart),
      checksum: received,
      wireLength,
    };
  }

  /**
   * Count frames we never saw.
   *
   * MAVLink sequence numbers are per sender and wrap at 256, so the gap is
   * computed modulo 256. A gap of 1 means "the next frame is the one we
   * expected"; anything larger is that many lost frames.
   */
  private accountSequence(frame: MavlinkFrame): void {
    const key = (frame.systemId << 8) | frame.componentId;
    const previous = this.lastSequence.get(key);
    if (previous !== undefined) {
      const gap = (frame.sequence - previous + 256) % 256;
      if (gap > 1) this.stats.framesLost += gap - 1;
    }
    this.lastSequence.set(key, frame.sequence);
  }
}

/**
 * Build a MAVLink v1 frame. Used to construct fixtures for the tests and to
 * send commands upstream once an uplink transport is wired in.
 */
export function encodeFrameV1(options: {
  sequence: number;
  systemId: number;
  componentId: number;
  messageId: number;
  payload: Uint8Array;
}): Uint8Array {
  const crcExtra = CRC_EXTRA[options.messageId];
  if (crcExtra === undefined) {
    throw new Error(`no CRC_EXTRA for message id ${options.messageId}`);
  }
  const writer = new ByteWriter(6 + options.payload.length + 2);
  writer.writeU8(MAVLINK_V1_STX);
  writer.writeU8(options.payload.length);
  writer.writeU8(options.sequence & 0xff);
  writer.writeU8(options.systemId);
  writer.writeU8(options.componentId);
  writer.writeU8(options.messageId);
  writer.writeBytes(options.payload);
  const partial = writer.toBytes();
  const crc = crc16Mcrf4xx(new Uint8Array([...partial.subarray(1), crcExtra]));
  writer.writeU8(crc & 0xff);
  writer.writeU8((crc >> 8) & 0xff);
  return writer.toBytes();
}

/**
 * Build a MAVLink v2 frame, applying the payload truncation the spec allows
 * (trailing zero bytes are not transmitted).
 */
export function encodeFrameV2(options: {
  sequence: number;
  systemId: number;
  componentId: number;
  messageId: number;
  payload: Uint8Array;
}): Uint8Array {
  const crcExtra = CRC_EXTRA[options.messageId];
  if (crcExtra === undefined) {
    throw new Error(`no CRC_EXTRA for message id ${options.messageId}`);
  }
  let end = options.payload.length;
  while (end > 1 && options.payload[end - 1] === 0) end -= 1;
  const payload = options.payload.subarray(0, end);

  const writer = new ByteWriter(10 + payload.length + 2);
  writer.writeU8(MAVLINK_V2_STX);
  writer.writeU8(payload.length);
  writer.writeU8(0); // incompat flags: unsigned
  writer.writeU8(0); // compat flags
  writer.writeU8(options.sequence & 0xff);
  writer.writeU8(options.systemId);
  writer.writeU8(options.componentId);
  writer.writeU8(options.messageId & 0xff);
  writer.writeU8((options.messageId >> 8) & 0xff);
  writer.writeU8((options.messageId >> 16) & 0xff);
  writer.writeBytes(payload);
  const partial = writer.toBytes();
  const crc = crc16Mcrf4xx(new Uint8Array([...partial.subarray(1), crcExtra]));
  writer.writeU8(crc & 0xff);
  writer.writeU8((crc >> 8) & 0xff);
  return writer.toBytes();
}

/** Decoded message payloads. Only the messages a GCS actually renders. */
export type DecodedMessage =
  | {
      type: 'heartbeat';
      customMode: number;
      vehicleTypeRaw: number;
      autopilotRaw: number;
      baseMode: number;
      systemStatus: number;
      mavlinkVersion: number;
    }
  | {
      type: 'sys_status';
      voltageV: number;
      currentA: number;
      remainingPct: number;
      dropRateCommPct: number;
      errorsComm: number;
    }
  | {
      type: 'gps_raw_int';
      timeUsec: number;
      latDeg: number;
      lonDeg: number;
      altAmslM: number;
      hdop: number;
      vdop: number;
      groundspeedMs: number;
      courseDeg: number;
      fixType: number;
      satellitesVisible: number;
    }
  | {
      type: 'attitude';
      timeBootMs: number;
      rollRad: number;
      pitchRad: number;
      yawRad: number;
      rollRateRadS: number;
      pitchRateRadS: number;
      yawRateRadS: number;
    }
  | {
      type: 'global_position_int';
      timeBootMs: number;
      latDeg: number;
      lonDeg: number;
      altAmslM: number;
      altRelM: number;
      vxMs: number;
      vyMs: number;
      vzMs: number;
      headingDeg: number;
    }
  | { type: 'mission_current'; seq: number }
  | { type: 'mission_item_reached'; seq: number }
  | {
      type: 'vfr_hud';
      airspeedMs: number;
      groundspeedMs: number;
      altAmslM: number;
      climbRateMs: number;
      headingDeg: number;
      throttlePct: number;
    }
  | {
      type: 'battery_status';
      id: number;
      voltageV: number;
      currentA: number;
      remainingPct: number;
      consumedMah: number;
      temperatureC: number | null;
      cellCount: number;
    }
  | { type: 'statustext'; severity: number; text: string };

/**
 * Zero-extend a possibly-truncated v2 payload to its full declared length.
 *
 * Skipping this step is the classic v2 bug: a HEARTBEAT whose trailing zero
 * bytes were trimmed reads short and the decoder either throws or returns
 * garbage for the last fields.
 */
function normalisePayload(messageId: number, payload: Uint8Array): Uint8Array {
  const expected = PAYLOAD_LENGTH[messageId];
  if (expected === undefined || payload.length >= expected) return payload;
  const padded = new Uint8Array(expected);
  padded.set(payload, 0);
  return padded;
}

const RAD_PER_DEG = Math.PI / 180;

/**
 * Turn a validated frame into a typed message, or `null` if it is a message
 * this ground station does not render.
 */
export function decodeMessage(frame: MavlinkFrame): DecodedMessage | null {
  const payload = normalisePayload(frame.messageId, frame.payload);
  const reader = new ByteReader(payload);

  switch (frame.messageId) {
    case MessageId.Heartbeat: {
      const customMode = reader.readU32();
      const vehicleTypeRaw = reader.readU8();
      const autopilotRaw = reader.readU8();
      const baseMode = reader.readU8();
      const systemStatus = reader.readU8();
      const mavlinkVersion = reader.readU8();
      return {
        type: 'heartbeat',
        customMode,
        vehicleTypeRaw,
        autopilotRaw,
        baseMode,
        systemStatus,
        mavlinkVersion,
      };
    }
    case MessageId.SysStatus: {
      reader.skip(12); // sensors present / enabled / health bitmasks
      reader.skip(2); // load
      const voltageV = reader.readU16() / 1000;
      const currentA = reader.readI16() / 100;
      const dropRateCommPct = reader.readU16() / 100;
      const errorsComm = reader.readU16();
      reader.skip(8); // errors_count1..4
      const remainingPct = reader.readI8();
      return {
        type: 'sys_status',
        voltageV,
        currentA,
        remainingPct,
        dropRateCommPct,
        errorsComm,
      };
    }
    case MessageId.GpsRawInt: {
      const timeUsec = reader.readU64AsNumber();
      const latDeg = reader.readI32() / 1e7;
      const lonDeg = reader.readI32() / 1e7;
      const altAmslM = reader.readI32() / 1000;
      const eph = reader.readU16();
      const epv = reader.readU16();
      const vel = reader.readU16();
      const cog = reader.readU16();
      const fixType = reader.readU8();
      const satellitesVisible = reader.readU8();
      return {
        type: 'gps_raw_int',
        timeUsec,
        latDeg,
        lonDeg,
        altAmslM,
        hdop: eph === 0xffff ? Number.NaN : eph / 100,
        vdop: epv === 0xffff ? Number.NaN : epv / 100,
        groundspeedMs: vel === 0xffff ? Number.NaN : vel / 100,
        courseDeg: cog === 0xffff ? Number.NaN : cog / 100,
        fixType,
        satellitesVisible: satellitesVisible === 0xff ? 0 : satellitesVisible,
      };
    }
    case MessageId.Attitude: {
      return {
        type: 'attitude',
        timeBootMs: reader.readU32(),
        rollRad: reader.readF32(),
        pitchRad: reader.readF32(),
        yawRad: reader.readF32(),
        rollRateRadS: reader.readF32(),
        pitchRateRadS: reader.readF32(),
        yawRateRadS: reader.readF32(),
      };
    }
    case MessageId.GlobalPositionInt: {
      const timeBootMs = reader.readU32();
      const latDeg = reader.readI32() / 1e7;
      const lonDeg = reader.readI32() / 1e7;
      const altAmslM = reader.readI32() / 1000;
      const altRelM = reader.readI32() / 1000;
      const vxMs = reader.readI16() / 100;
      const vyMs = reader.readI16() / 100;
      const vzMs = reader.readI16() / 100;
      const hdg = reader.readU16();
      return {
        type: 'global_position_int',
        timeBootMs,
        latDeg,
        lonDeg,
        altAmslM,
        altRelM,
        vxMs,
        vyMs,
        vzMs,
        headingDeg: hdg === 0xffff ? Number.NaN : hdg / 100,
      };
    }
    case MessageId.MissionCurrent:
      return { type: 'mission_current', seq: reader.readU16() };
    case MessageId.MissionItemReached:
      return { type: 'mission_item_reached', seq: reader.readU16() };
    case MessageId.VfrHud: {
      const airspeedMs = reader.readF32();
      const groundspeedMs = reader.readF32();
      const altAmslM = reader.readF32();
      const climbRateMs = reader.readF32();
      const headingDeg = reader.readI16();
      const throttlePct = reader.readU16();
      return {
        type: 'vfr_hud',
        airspeedMs,
        groundspeedMs,
        altAmslM,
        climbRateMs,
        headingDeg: (headingDeg + 360) % 360,
        throttlePct,
      };
    }
    case MessageId.BatteryStatus: {
      const consumedMah = reader.readI32();
      reader.skip(4); // energy_consumed, hJ
      const temperatureRaw = reader.readI16();
      let voltageV = 0;
      let cellCount = 0;
      for (let cell = 0; cell < 10; cell += 1) {
        const mv = reader.readU16();
        // 0xFFFF means "cell not present"; 0 means "present, reading zero".
        if (mv === 0xffff) continue;
        voltageV += mv / 1000;
        cellCount += 1;
      }
      const currentA = reader.readI16() / 100;
      const id = reader.readU8();
      reader.skip(2); // battery_function, type
      const remainingPct = reader.readI8();
      return {
        type: 'battery_status',
        id,
        voltageV,
        currentA,
        remainingPct,
        consumedMah: consumedMah < 0 ? 0 : consumedMah,
        temperatureC: temperatureRaw === 0x7fff ? null : temperatureRaw / 100,
        cellCount,
      };
    }
    case MessageId.Statustext: {
      const severity = reader.readU8();
      const text = reader.readString(50);
      return { type: 'statustext', severity, text };
    }
    default:
      return null;
  }
}

/** Degrees to radians. Exported because the demo link builds attitude payloads. */
export function degToRad(deg: number): number {
  return deg * RAD_PER_DEG;
}
