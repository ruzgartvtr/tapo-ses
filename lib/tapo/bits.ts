/** Bit writer matching the MPEG-TS muxer layout used for Tapo backchannel audio. */
export class BitWriter {
  buf: number[] = [];
  bits = 0;
  private byteIndex = -1;

  writeByte(b: number): void {
    if (this.bits !== 0) {
      this.writeBits8(b, 8);
      return;
    }
    this.buf.push(b & 0xff);
  }

  writeBit(b: number): void {
    if (this.bits === 0) {
      this.buf.push(0);
      this.byteIndex = this.buf.length - 1;
      this.bits = 7;
    } else {
      this.bits -= 1;
    }
    this.buf[this.byteIndex] =
      (this.buf[this.byteIndex]! | ((b & 1) << this.bits)) & 0xff;
  }

  writeBits(v: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.writeBit((v >> i) & 1);
  }

  writeBits16(v: number, n: number): void {
    this.writeBits(v, n);
  }

  writeBits8(v: number, n: number): void {
    this.writeBits(v, n);
  }

  writeUint16(v: number): void {
    if (this.bits !== 0) {
      this.writeBits16(v, 16);
      return;
    }
    this.buf.push((v >> 8) & 0xff, v & 0xff);
  }

  writeBytes(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.writeByte(bytes[i]!);
  }

  bytes(): Buffer {
    return Buffer.from(this.buf);
  }

  len(): number {
    return this.buf.length;
  }
}
