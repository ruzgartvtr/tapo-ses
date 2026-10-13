import { BitWriter } from "./bits";

/** Tapo private stream type for G.711 A-law. */
export const STREAM_TYPE_PCMA_TAPO = 0x90;
const PACKET_SIZE = 188;
const SYNC_BYTE = 0x47;
const PAT_PID = 0;
const PMT_PID = 0x1000;
const PES0_PID = 0x100;

type Pes = {
  streamType: number;
  streamId: number;
  pts: number;
  timestamp: number;
  payload: Buffer;
  size: number;
  sequence: number;
};

function mpegCrc(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x80000000) crc = ((crc << 1) ^ 0x04c11db7) >>> 0;
      else crc = (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}

function writeTime(target: Buffer, offset: number, timestamp: number): void {
  const t = timestamp >>> 0;
  const onlyPts = 0x20;
  target[offset] = (onlyPts | (t >>> (32 - 3)) | 1) & 0xff;
  target[offset + 1] = (t >>> (24 - 2)) & 0xff;
  target[offset + 2] = ((t >>> (16 - 2)) | 1) & 0xff;
  target[offset + 3] = (t >>> (8 - 1)) & 0xff;
  target[offset + 4] = ((t << 1) | 1) & 0xff;
}

/**
 * MPEG-TS muxer for a single PCMA track.
 * Packet layout follows the Tapo talk path: PAT/PMT once, then PES packets.
 */
export class PcmaMuxer {
  private pes = new Map<number, Pes>();

  addTrack(streamType = STREAM_TYPE_PCMA_TAPO): number {
    const pes: Pes = {
      streamType,
      streamId: 0xc0,
      pts: 0,
      timestamp: 0,
      payload: Buffer.alloc(0),
      size: 0,
      sequence: 0,
    };
    const pid = PES0_PID + this.pes.size;
    this.pes.set(pid, pes);
    return pid;
  }

  getHeader(): Buffer {
    const wr = new BitWriter();
    this.writePat(wr);
    this.writePmt(wr);
    return wr.bytes();
  }

  /** timestamp is the RTP-style sample clock (8 kHz for PCMA). */
  getPayload(pid: number, timestamp: number, payload: Buffer): Buffer {
    const pes = this.pes.get(pid);
    if (!pes) throw new Error("Bilinmeyen MPEG-TS parçası");

    if (pes.timestamp !== 0) {
      pes.pts = (pes.pts + (timestamp - pes.timestamp)) >>> 0;
    }
    pes.timestamp = timestamp >>> 0;

    const size = 3 + 5 + payload.length;
    const header = Buffer.alloc(14);
    header[0] = 0;
    header[1] = 0;
    header[2] = 1;
    header[3] = pes.streamId;
    if (size <= 0xffff) header.writeUInt16BE(size, 4);
    header[6] = 0x80;
    header[7] = 0x80;
    header[8] = 5;
    writeTime(header, 9, pes.pts);

    pes.payload = Buffer.concat([header, payload]);
    pes.size = 1;

    const wr = new BitWriter();
    while (pes.payload.length > 0) {
      this.writePes(wr, pid, pes);
      pes.sequence += 1;
      pes.size = 0;
    }
    return wr.bytes();
  }

  private writePat(wr: BitWriter): void {
    this.writeHeader(wr, PAT_PID);
    const crcStart = wr.len() + 1;
    this.writePsiHeader(wr, 0, 4);
    wr.writeUint16(1);
    wr.writeBits8(0b111, 3);
    wr.writeBits16(PMT_PID, 13);
    const crc = mpegCrc(wr.bytes().subarray(crcStart));
    wr.writeByte(crc >>> 24);
    wr.writeByte((crc >>> 16) & 0xff);
    wr.writeByte((crc >>> 8) & 0xff);
    wr.writeByte(crc & 0xff);
    this.writeTail(wr);
  }

  private writePmt(wr: BitWriter): void {
    this.writeHeader(wr, PMT_PID);
    const crcStart = wr.len() + 1;
    this.writePsiHeader(wr, 2, 4 + this.pes.size * 5);
    wr.writeBits8(0b111, 3);
    wr.writeBits16(0x1fff, 13);
    wr.writeBits8(0b1111, 4);
    wr.writeBits8(0, 2);
    wr.writeBits16(0, 10);

    for (const [pid, pes] of this.pes) {
      wr.writeByte(pes.streamType);
      wr.writeBits8(0b111, 3);
      wr.writeBits16(pid, 13);
      wr.writeBits8(0b1111, 4);
      wr.writeBits(0, 2);
      wr.writeBits16(0, 10);
    }

    const crc = mpegCrc(wr.bytes().subarray(crcStart));
    wr.writeByte(crc >>> 24);
    wr.writeByte((crc >>> 16) & 0xff);
    wr.writeByte((crc >>> 8) & 0xff);
    wr.writeByte(crc & 0xff);
    this.writeTail(wr);
  }

  private writePes(wr: BitWriter, pid: number, pes: Pes): void {
    const flagPusi = 0b0100_0000_0000_0000;
    const flagAdaptation = 0b0010_0000;
    const flagPayload = 0b0001_0000;

    wr.writeByte(SYNC_BYTE);
    let pidField = pid;
    if (pes.size !== 0) pidField |= flagPusi;
    wr.writeUint16(pidField);

    const counter = pes.sequence & 0xf;
    const size = pes.payload.length;
    if (size < PACKET_SIZE - 4) {
      wr.writeByte(flagAdaptation | flagPayload | counter);
      const adSize = PACKET_SIZE - 4 - 1 - size;
      wr.writeByte(adSize);
      if (adSize > 0) wr.writeBytes(Buffer.alloc(adSize));
      wr.writeBytes(pes.payload);
      pes.payload = Buffer.alloc(0);
    } else {
      wr.writeByte(flagPayload | counter);
      wr.writeBytes(pes.payload.subarray(0, PACKET_SIZE - 4));
      pes.payload = pes.payload.subarray(PACKET_SIZE - 4);
    }
  }

  private writeHeader(wr: BitWriter, pid: number): void {
    wr.writeByte(SYNC_BYTE);
    wr.writeBit(0);
    wr.writeBit(1);
    wr.writeBit(0);
    wr.writeBits16(pid, 13);
    wr.writeBits8(0, 2);
    wr.writeBit(0);
    wr.writeBit(1);
    wr.writeBits8(0, 4);
  }

  private writePsiHeader(wr: BitWriter, tableId: number, size: number): void {
    wr.writeByte(0);
    wr.writeByte(tableId);
    wr.writeBit(1);
    wr.writeBit(0);
    wr.writeBits8(0b11, 2);
    wr.writeBits8(0, 2);
    wr.writeBits16(5 + size + 4, 10);
    wr.writeUint16(1);
    wr.writeBits8(0b11, 2);
    wr.writeBits8(0, 5);
    wr.writeBit(1);
    wr.writeByte(0);
    wr.writeByte(0);
  }

  private writeTail(wr: BitWriter): void {
    const remainder = wr.len() % PACKET_SIZE;
    if (remainder === 0) return;
    const size = PACKET_SIZE - remainder;
    wr.writeBytes(Buffer.alloc(size));
  }
}

export function assertTsPackets(buffer: Buffer): void {
  if (buffer.length === 0 || buffer.length % PACKET_SIZE !== 0) {
    throw new Error("MPEG-TS paketi 188 bayt hizalı değil");
  }
  for (let i = 0; i < buffer.length; i += PACKET_SIZE) {
    if (buffer[i] !== SYNC_BYTE) throw new Error("MPEG-TS senkron baytı yok");
  }
}
