/**
 * Little-endian binary readers and the CRC used by MAVLink.
 *
 * Implemented over `DataView` rather than Node's `Buffer` because this code
 * runs inside Hermes on the phone, where `Buffer` does not exist unless you
 * ship a polyfill. `DataView` is available everywhere and is explicit about
 * endianness, which is the thing people get wrong.
 */

/** Thrown when a read would run past the end of the backing buffer. */
export class ByteReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ByteReaderError';
  }
}

/**
 * Sequential little-endian reader over a byte range.
 *
 * MAVLink payloads are packed little-endian with no alignment padding, so a
 * cursor-style reader is a direct match for the wire format.
 */
export class ByteReader {
  private readonly view: DataView;
  private cursor = 0;

  constructor(bytes: Uint8Array, byteOffset = 0, byteLength?: number) {
    const length = byteLength ?? bytes.length - byteOffset;
    if (byteOffset < 0 || length < 0 || byteOffset + length > bytes.length) {
      throw new ByteReaderError('reader range outside the backing array');
    }
    this.view = new DataView(bytes.buffer, bytes.byteOffset + byteOffset, length);
  }

  /** Bytes not yet consumed. */
  get remaining(): number {
    return this.view.byteLength - this.cursor;
  }

  /** Current read offset from the start of the range. */
  get offset(): number {
    return this.cursor;
  }

  /** Move the cursor to an absolute offset within the range. */
  seek(offset: number): this {
    if (offset < 0 || offset > this.view.byteLength) {
      throw new ByteReaderError(`seek(${offset}) outside range`);
    }
    this.cursor = offset;
    return this;
  }

  /** Advance the cursor without reading. */
  skip(count: number): this {
    return this.seek(this.cursor + count);
  }

  private take(size: number): number {
    if (this.cursor + size > this.view.byteLength) {
      throw new ByteReaderError(
        `read of ${size} byte(s) at ${this.cursor} exceeds ${this.view.byteLength}`,
      );
    }
    const at = this.cursor;
    this.cursor += size;
    return at;
  }

  readU8(): number {
    return this.view.getUint8(this.take(1));
  }

  readI8(): number {
    return this.view.getInt8(this.take(1));
  }

  readU16(): number {
    return this.view.getUint16(this.take(2), true);
  }

  readI16(): number {
    return this.view.getInt16(this.take(2), true);
  }

  readU32(): number {
    return this.view.getUint32(this.take(4), true);
  }

  readI32(): number {
    return this.view.getInt32(this.take(4), true);
  }

  /**
   * Read a 64-bit unsigned integer as a JS number.
   *
   * MAVLink uses u64 only for microsecond timestamps. Those stay well inside
   * `Number.MAX_SAFE_INTEGER` (2^53 us is about 285 years), so the lossy
   * conversion is safe here and avoids forcing BigInt on the render path.
   */
  readU64AsNumber(): number {
    const at = this.take(8);
    const lo = this.view.getUint32(at, true);
    const hi = this.view.getUint32(at + 4, true);
    return hi * 0x1_0000_0000 + lo;
  }

  readF32(): number {
    return this.view.getFloat32(this.take(4), true);
  }

  readF64(): number {
    return this.view.getFloat64(this.take(8), true);
  }

  /** Read a fixed-length, NUL-padded ASCII string (MAVLink char[N]). */
  readString(length: number): string {
    const at = this.take(length);
    let out = '';
    for (let i = 0; i < length; i += 1) {
      const code = this.view.getUint8(at + i);
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out;
  }
}

/** Sequential little-endian writer. Used to build frames for tests and uplink. */
export class ByteWriter {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private cursor = 0;

  constructor(capacity: number) {
    this.bytes = new Uint8Array(capacity);
    this.view = new DataView(this.bytes.buffer);
  }

  get offset(): number {
    return this.cursor;
  }

  writeU8(value: number): this {
    this.view.setUint8(this.cursor, value);
    this.cursor += 1;
    return this;
  }

  writeI8(value: number): this {
    this.view.setInt8(this.cursor, value);
    this.cursor += 1;
    return this;
  }

  writeU16(value: number): this {
    this.view.setUint16(this.cursor, value, true);
    this.cursor += 2;
    return this;
  }

  writeI16(value: number): this {
    this.view.setInt16(this.cursor, value, true);
    this.cursor += 2;
    return this;
  }

  writeU32(value: number): this {
    this.view.setUint32(this.cursor, value, true);
    this.cursor += 4;
    return this;
  }

  writeI32(value: number): this {
    this.view.setInt32(this.cursor, value, true);
    this.cursor += 4;
    return this;
  }

  writeU64(value: number): this {
    const lo = value >>> 0;
    const hi = Math.floor(value / 0x1_0000_0000) >>> 0;
    this.view.setUint32(this.cursor, lo, true);
    this.view.setUint32(this.cursor + 4, hi, true);
    this.cursor += 8;
    return this;
  }

  writeF32(value: number): this {
    this.view.setFloat32(this.cursor, value, true);
    this.cursor += 4;
    return this;
  }

  writeBytes(source: Uint8Array): this {
    this.bytes.set(source, this.cursor);
    this.cursor += source.length;
    return this;
  }

  /** Copy of everything written so far. */
  toBytes(): Uint8Array {
    return this.bytes.slice(0, this.cursor);
  }
}

/**
 * CRC-16/MCRF4XX, implemented from scratch.
 *
 * width=16 poly=0x1021 init=0xFFFF refin=true refout=true xorout=0x0000.
 * Reflecting the polynomial gives 0x8408 and lets the loop shift right, which
 * is how the reference MAVLink `crc_accumulate` is written. Catalogue check
 * value: CRC of the ASCII string "123456789" is 0x6F91.
 *
 * MAVLink appends `CRC_EXTRA` (a per-message hash of the field definitions) to
 * the checksummed bytes. That is what makes a receiver with the wrong message
 * definition reject the frame instead of silently misreading it.
 */
export function crc16Mcrf4xx(bytes: Uint8Array, seed = 0xffff): number {
  let crc = seed & 0xffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i] & 0xff;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** Fold a single byte into a running CRC. Same algorithm, incremental form. */
export function crcAccumulate(byte: number, crc: number): number {
  let acc = crc & 0xffff;
  acc ^= byte & 0xff;
  for (let bit = 0; bit < 8; bit += 1) {
    acc = acc & 1 ? (acc >>> 1) ^ 0x8408 : acc >>> 1;
  }
  return acc & 0xffff;
}
