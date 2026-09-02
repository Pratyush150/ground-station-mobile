import { describe, expect, it } from 'vitest';

import { ByteWriter } from '../src/core/telemetry/binary';
import {
  FrameParser,
  MessageId,
  decodeMessage,
  encodeFrameV1,
  encodeFrameV2,
} from '../src/core/telemetry/decode';

function heartbeatPayload(customMode: number, baseMode: number): Uint8Array {
  return new ByteWriter(9)
    .writeU32(customMode)
    .writeU8(2) // quadrotor
    .writeU8(12) // PX4
    .writeU8(baseMode)
    .writeU8(4) // ACTIVE
    .writeU8(3)
    .toBytes();
}

function attitudePayload(roll: number, pitch: number, yaw: number): Uint8Array {
  return new ByteWriter(28)
    .writeU32(12345)
    .writeF32(roll)
    .writeF32(pitch)
    .writeF32(yaw)
    .writeF32(0)
    .writeF32(0)
    .writeF32(0)
    .toBytes();
}

function heartbeatFrame(sequence: number): Uint8Array {
  return encodeFrameV1({
    sequence,
    systemId: 1,
    componentId: 1,
    messageId: MessageId.Heartbeat,
    payload: heartbeatPayload(0x04040000, 209),
  });
}

describe('FrameParser', () => {
  it('decodes a complete v1 frame delivered in one read', () => {
    const parser = new FrameParser();
    const frames = parser.push(heartbeatFrame(7));
    expect(frames).toHaveLength(1);
    expect(frames[0].messageId).toBe(MessageId.Heartbeat);
    expect(frames[0].sequence).toBe(7);
    expect(frames[0].systemId).toBe(1);
    expect(frames[0].version).toBe(1);
    expect(parser.stats.crcErrors).toBe(0);
  });

  it('decodes a frame split across two reads, exactly once', () => {
    const frame = heartbeatFrame(1);
    const parser = new FrameParser();

    const first = parser.push(frame.slice(0, 9));
    expect(first).toHaveLength(0);
    expect(parser.pendingBytes).toBe(9);

    const second = parser.push(frame.slice(9));
    expect(second).toHaveLength(1);
    expect(second[0].sequence).toBe(1);
    expect(parser.pendingBytes).toBe(0);
    expect(parser.stats.framesDecoded).toBe(1);
  });

  it('decodes a frame split one byte at a time', () => {
    const frame = heartbeatFrame(2);
    const parser = new FrameParser();
    let decoded = 0;
    for (const byte of frame) decoded += parser.push(new Uint8Array([byte])).length;
    expect(decoded).toBe(1);
  });

  it('rejects a frame whose checksum was corrupted in flight', () => {
    const frame = heartbeatFrame(3);
    frame[7] ^= 0x40; // flip a payload bit after the CRC was computed
    const parser = new FrameParser();
    expect(parser.push(frame)).toHaveLength(0);
    expect(parser.stats.crcErrors).toBe(1);
    expect(parser.stats.framesDecoded).toBe(0);
  });

  it('resyncs after garbage and still decodes the following frame', () => {
    const parser = new FrameParser();
    const garbage = new Uint8Array([0x11, 0x22, 0x33, 0x44]);
    const frame = heartbeatFrame(4);
    const combined = new Uint8Array([...garbage, ...frame]);
    const frames = parser.push(combined);
    expect(frames).toHaveLength(1);
    expect(parser.stats.bytesDropped).toBe(4);
  });

  it('counts lost frames from sequence-number gaps', () => {
    const parser = new FrameParser();
    parser.push(heartbeatFrame(0));
    parser.push(heartbeatFrame(1));
    parser.push(heartbeatFrame(5)); // 2, 3, 4 never arrived
    expect(parser.stats.framesLost).toBe(3);
    expect(parser.stats.framesDecoded).toBe(3);
  });

  it('handles sequence wrap-around without inventing losses', () => {
    const parser = new FrameParser();
    parser.push(heartbeatFrame(254));
    parser.push(heartbeatFrame(255));
    parser.push(heartbeatFrame(0));
    expect(parser.stats.framesLost).toBe(0);
  });

  it('tracks sequence numbers per sender', () => {
    const parser = new FrameParser();
    const other = encodeFrameV1({
      sequence: 200,
      systemId: 2,
      componentId: 1,
      messageId: MessageId.Heartbeat,
      payload: heartbeatPayload(0, 81),
    });
    parser.push(heartbeatFrame(10));
    parser.push(other);
    parser.push(heartbeatFrame(11));
    expect(parser.stats.framesLost).toBe(0);
  });

  it('decodes several frames arriving in one chunk', () => {
    const parser = new FrameParser();
    const chunk = new Uint8Array([...heartbeatFrame(20), ...heartbeatFrame(21), ...heartbeatFrame(22)]);
    expect(parser.push(chunk)).toHaveLength(3);
  });

  it('zero-extends a truncated MAVLink v2 payload', () => {
    // system_status and mavlink_version left at zero, so the sender trims them.
    const payload = new ByteWriter(9)
      .writeU32(0x04040000)
      .writeU8(2)
      .writeU8(12)
      .writeU8(209)
      .writeU8(0)
      .writeU8(0)
      .toBytes();
    const frame = encodeFrameV2({
      sequence: 0,
      systemId: 1,
      componentId: 1,
      messageId: MessageId.Heartbeat,
      payload,
    });
    const parser = new FrameParser();
    const frames = parser.push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].version).toBe(2);
    expect(frames[0].payload.length).toBe(7);

    const message = decodeMessage(frames[0]);
    expect(message?.type).toBe('heartbeat');
    if (message?.type === 'heartbeat') {
      expect(message.customMode).toBe(0x04040000);
      expect(message.systemStatus).toBe(0);
      expect(message.mavlinkVersion).toBe(0);
    }
  });
});

describe('decodeMessage', () => {
  it('decodes ATTITUDE floats through a full frame round trip', () => {
    const frame = encodeFrameV1({
      sequence: 0,
      systemId: 1,
      componentId: 1,
      messageId: MessageId.Attitude,
      payload: attitudePayload(0.5, -0.25, 1.5),
    });
    const parsed = new FrameParser().push(frame)[0];
    const message = decodeMessage(parsed);
    expect(message?.type).toBe('attitude');
    if (message?.type === 'attitude') {
      expect(message.rollRad).toBeCloseTo(0.5, 6);
      expect(message.pitchRad).toBeCloseTo(-0.25, 6);
      expect(message.yawRad).toBeCloseTo(1.5, 6);
      expect(message.timeBootMs).toBe(12345);
    }
  });

  it('scales GLOBAL_POSITION_INT integers back to degrees and metres', () => {
    const payload = new ByteWriter(28)
      .writeU32(1000)
      .writeI32(473977419)
      .writeI32(85455938)
      .writeI32(528000)
      .writeI32(40000)
      .writeI16(1200)
      .writeI16(-300)
      .writeI16(50)
      .writeU16(9000)
      .toBytes();
    const frame = encodeFrameV1({
      sequence: 0,
      systemId: 1,
      componentId: 1,
      messageId: MessageId.GlobalPositionInt,
      payload,
    });
    const message = decodeMessage(new FrameParser().push(frame)[0]);
    expect(message?.type).toBe('global_position_int');
    if (message?.type === 'global_position_int') {
      expect(message.latDeg).toBeCloseTo(47.3977419, 7);
      expect(message.lonDeg).toBeCloseTo(8.5455938, 7);
      expect(message.altAmslM).toBeCloseTo(528, 3);
      expect(message.altRelM).toBeCloseTo(40, 3);
      expect(message.vxMs).toBeCloseTo(12, 3);
      expect(message.vyMs).toBeCloseTo(-3, 3);
      expect(message.headingDeg).toBeCloseTo(90, 3);
    }
  });

  it('reports GPS_RAW_INT unknown values as NaN rather than 655.35', () => {
    const payload = new ByteWriter(30)
      .writeU64(0)
      .writeI32(0)
      .writeI32(0)
      .writeI32(0)
      .writeU16(0xffff)
      .writeU16(0xffff)
      .writeU16(0xffff)
      .writeU16(0xffff)
      .writeU8(3)
      .writeU8(11)
      .toBytes();
    const frame = encodeFrameV1({
      sequence: 0,
      systemId: 1,
      componentId: 1,
      messageId: MessageId.GpsRawInt,
      payload,
    });
    const message = decodeMessage(new FrameParser().push(frame)[0]);
    expect(message?.type).toBe('gps_raw_int');
    if (message?.type === 'gps_raw_int') {
      expect(Number.isNaN(message.hdop)).toBe(true);
      expect(message.fixType).toBe(3);
      expect(message.satellitesVisible).toBe(11);
    }
  });

  it('decodes SYS_STATUS battery fields at their real payload offsets', () => {
    const payload = new ByteWriter(31)
      .writeU32(0)
      .writeU32(0)
      .writeU32(0)
      .writeU16(250)
      .writeU16(22800) // 22.8 V
      .writeI16(1550) // 15.5 A
      .writeU16(0)
      .writeU16(0)
      .writeU16(0)
      .writeU16(0)
      .writeU16(0)
      .writeU16(0)
      .writeI8(64)
      .toBytes();
    const frame = encodeFrameV1({
      sequence: 0,
      systemId: 1,
      componentId: 1,
      messageId: MessageId.SysStatus,
      payload,
    });
    const message = decodeMessage(new FrameParser().push(frame)[0]);
    expect(message?.type).toBe('sys_status');
    if (message?.type === 'sys_status') {
      expect(message.voltageV).toBeCloseTo(22.8, 6);
      expect(message.currentA).toBeCloseTo(15.5, 6);
      expect(message.remainingPct).toBe(64);
    }
  });
});
