/** G.711 A-law, the codec Tapo speakers (including C210) accept on the talk channel. */

const SIGN_BIT = 0x80;
const QUANT_MASK = 0x0f;
const SEG_SHIFT = 4;
const SEG_MASK = 0x70;
const ALAW_AMI = 0x55;

export function linearToAlaw(sample: number): number {
  let pcm = Math.max(-32768, Math.min(32767, Math.round(sample)));
  let mask: number;
  if (pcm >= 0) {
    mask = ALAW_AMI | SIGN_BIT;
  } else {
    mask = ALAW_AMI;
    pcm = -pcm - 1;
  }

  let seg = 7;
  let exp = 0x4000;
  while (seg > 0 && (pcm & exp) === 0) {
    seg -= 1;
    exp >>= 1;
  }

  const mantissa =
    seg === 0 ? (pcm >> 4) & QUANT_MASK : (pcm >> (seg + 3)) & QUANT_MASK;
  return ((seg << SEG_SHIFT) | mantissa) ^ mask;
}

export function alawToLinear(alaw: number): number {
  let value = alaw ^ ALAW_AMI;
  const sign = value & SIGN_BIT;
  const exponent = (value & SEG_MASK) >> SEG_SHIFT;
  let sample = ((value & QUANT_MASK) << 4) + 8;
  if (exponent !== 0) sample += 0x100;
  if (exponent > 1) sample <<= exponent - 1;
  return sign ? sample : -sample;
}

/** 100 is unity gain. Values above 100 boost until the sample clips. */
export function applyVolume(alaw: Buffer, volume: number): Buffer {
  if (!Number.isFinite(volume) || volume === 100) return alaw;
  const gain = Math.max(0, Math.min(volume, 200)) / 100;
  const out = Buffer.alloc(alaw.length);
  for (let i = 0; i < alaw.length; i++) {
    const scaled = alawToLinear(alaw[i]!) * gain;
    out[i] = linearToAlaw(scaled);
  }
  return out;
}
