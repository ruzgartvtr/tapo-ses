import { applyVolume } from "./alaw";
import { playAlawOnTapo, type TapoTalkTarget } from "./talk";
import { transcodeToAlaw } from "./transcode";

const active = new Map<string, AbortController>();

export type PlayRequest = TapoTalkTarget & {
  volume?: number;
  file: Buffer;
};

export function stopPlayback(host: string): boolean {
  const current = active.get(host.trim());
  if (!current) return false;
  current.abort();
  return true;
}

export async function playAudioFile(
  request: PlayRequest,
  signal?: AbortSignal,
): Promise<{
  durationMs: number;
  bytes: number;
  truncated: boolean;
  codec: "PCMA/8000";
}> {
  const host = request.host.trim();
  if (active.has(host)) {
    throw new PlayBusyError();
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  active.set(host, controller);
  try {
    const { audio, truncated } = await transcodeToAlaw(request.file);
    const shaped = applyVolume(audio, request.volume ?? 100);
    const result = await playAlawOnTapo(
      {
        host,
        password: request.password,
        passwordIsHash: request.passwordIsHash,
      },
      shaped,
      { signal: controller.signal },
    );
    return { ...result, truncated, codec: "PCMA/8000" };
  } finally {
    signal?.removeEventListener("abort", abort);
    if (active.get(host) === controller) active.delete(host);
  }
}

export class PlayBusyError extends Error {
  constructor() {
    super("Bu kamera şu an başka bir ses çalıyor.");
    this.name = "PlayBusyError";
  }
}

export function assertBridgeToken(authorization: string | null, expected: string | undefined): void {
  if (!expected) return;
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (provided.length !== expected.length) {
    throw new TokenError();
  }
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) throw new TokenError();
}

export class TokenError extends Error {
  constructor() {
    super("Köprü anahtarı geçersiz.");
    this.name = "TokenError";
  }
}
