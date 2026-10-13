import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const size = 512;
const raw = Buffer.alloc((size * 4 + 1) * size);
const ink = [16, 17, 14];
const lime = [231, 255, 106];
const copper = [224, 138, 79];
const cream = [236, 231, 223];

function insideRound(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || y < top || x >= right || y >= bottom) return false;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

for (let y = 0; y < size; y++) {
  const row = y * (size * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < size; x++) {
    const dx = x - 256;
    const dy = y - 250;
    const dist = Math.hypot(dx, dy);
    let color = ink;
    if (insideRound(x, y, 96, 36, 320, 440, 150)) color = cream;
    if (insideRound(x, y, 132, 78, 248, 280, 124)) color = [27, 29, 24];
    if (dist < 92 && dist > 78) color = lime;
    if (dist <= 48) color = [42, 46, 38];
    if (dist <= 22) color = lime;
    if (Math.hypot(x - 268, y - 236) < 8) color = [255, 255, 255];
    if (insideRound(x, y, 196, 390, 120, 18, 9)) color = [200, 194, 182];
    const i = row + 1 + x * 4;
    raw[i] = color[0];
    raw[i + 1] = color[1];
    raw[i + 2] = color[2];
    raw[i + 3] = 255;
    void copper;
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return ~crc >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("../build/icon.png", import.meta.url), png);
