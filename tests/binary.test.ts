import { describe, expect, it } from 'vitest';

import { ByteReader, ByteWriter, crc16Mcrf4xx, crcAccumulate } from '../src/core/telemetry/binary';

describe('CRC-16/MCRF4XX', () => {
  it('matches the catalogue check value for "123456789"', () => {
    const input = new Uint8Array([...'123456789'].map((c) => c.charCodeAt(0)));
    expect(crc16Mcrf4xx(input)).toBe(0x6f91);
  });

  it('returns the seed for an empty input', () => {
    expect(crc16Mcrf4xx(new Uint8Array(0))).toBe(0xffff);
  });

  it('is order sensitive', () => {
    expect(crc16Mcrf4xx(new Uint8Array([0x01, 0x02]))).not.toBe(
      crc16Mcrf4xx(new Uint8Array([0x02, 0x01])),
    );
  });

  it('accumulates byte by byte to the same value as the bulk form', () => {
    const input = new Uint8Array([0x09, 0x00, 0x01, 0x01, 0x00, 0xfe, 0x2a]);
    let incremental = 0xffff;
    for (const byte of input) incremental = crcAccumulate(byte, incremental);
    expect(incremental).toBe(crc16Mcrf4xx(input));
  });

  it('stays inside 16 bits', () => {
    const input = new Uint8Array(64).fill(0xff);
    const crc = crc16Mcrf4xx(input);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffff);
  });
});

describe('little-endian readers', () => {
  it('reads a 32-bit float from a known byte pattern', () => {
    expect(new ByteReader(new Uint8Array([0x00, 0x00, 0x80, 0x3f])).readF32()).toBe(1);
    expect(new ByteReader(new Uint8Array([0x00, 0x00, 0x20, 0x41])).readF32()).toBe(10);
    expect(new ByteReader(new Uint8Array([0x00, 0x00, 0x80, 0xbf])).readF32()).toBe(-1);
  });

  it('reads signed and unsigned integers little-endian', () => {
    expect(new ByteReader(new Uint8Array([0x2c, 0x01, 0x00, 0x00])).readI32()).toBe(300);
    expect(new ByteReader(new Uint8Array([0xe8, 0x03])).readU16()).toBe(1000);
    expect(new ByteReader(new Uint8Array([0xff, 0xff])).readI16()).toBe(-1);
    expect(new ByteReader(new Uint8Array([0xff, 0xff])).readU16()).toBe(65535);
    expect(new ByteReader(new Uint8Array([0x9c, 0xff, 0xff, 0xff])).readI32()).toBe(-100);
  });

  it('reads a 64-bit microsecond timestamp as a safe number', () => {
    const writer = new ByteWriter(8).writeU64(1_700_000_000_000_000);
    expect(new ByteReader(writer.toBytes()).readU64AsNumber()).toBe(1_700_000_000_000_000);
  });

  it('reads NUL-padded fixed-length strings', () => {
    const bytes = new Uint8Array(8);
    bytes.set([0x50, 0x58, 0x34], 0); // "PX4"
    expect(new ByteReader(bytes).readString(8)).toBe('PX4');
  });

  it('tracks the cursor and refuses to read past the end', () => {
    const reader = new ByteReader(new Uint8Array([1, 2, 3, 4]));
    reader.readU16();
    expect(reader.offset).toBe(2);
    expect(reader.remaining).toBe(2);
    reader.readU16();
    expect(() => reader.readU8()).toThrow(/exceeds/);
  });

  it('round-trips every writer type through the reader', () => {
    const bytes = new ByteWriter(32)
      .writeU8(200)
      .writeI8(-5)
      .writeU16(60000)
      .writeI16(-300)
      .writeU32(4_000_000_000)
      .writeI32(-70000)
      .writeF32(0.5)
      .toBytes();
    const reader = new ByteReader(bytes);
    expect(reader.readU8()).toBe(200);
    expect(reader.readI8()).toBe(-5);
    expect(reader.readU16()).toBe(60000);
    expect(reader.readI16()).toBe(-300);
    expect(reader.readU32()).toBe(4_000_000_000);
    expect(reader.readI32()).toBe(-70000);
    expect(reader.readF32()).toBe(0.5);
  });
});
