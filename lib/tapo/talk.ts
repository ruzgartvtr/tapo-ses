import { connect, type Socket } from "node:net";

import { buildDigestAuthorization, hashCloudPassword, parseDigestChallenge } from "./digest";
import { PcmaMuxer, assertTsPackets } from "./mpegts";

const FRAME_BYTES = 160;
const SAMPLE_RATE = 8000;

export type TapoTalkTarget = {
  host: string;
  password: string;
  /** Set when `password` is already the uppercase MD5 or SHA256 cloud hash. */
  passwordIsHash?: boolean;
};

export type TalkProgress = {
  sentFrames: number;
  totalFrames: number;
};

type Endpoint = { hostname: string; port: number };

export function parseCameraHost(host: string): Endpoint {
  const trimmed = host.trim();
  if (!trimmed || /[\s/]/.test(trimmed)) {
    throw new Error("Kamera adresi geçersiz");
  }
  if (trimmed === "169.254.169.254" || trimmed.startsWith("169.254.169.254:")) {
    throw new Error("Bu adres kullanılamaz");
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && /^\d{1,5}$/.test(trimmed.slice(colon + 1))) {
    const port = Number(trimmed.slice(colon + 1));
    if (port < 1 || port > 65535) throw new Error("Kamera portu geçersiz");
    return { hostname: trimmed.slice(0, colon), port };
  }
  return { hostname: trimmed, port: 8800 };
}

class BytePump {
  private buf = Buffer.alloc(0);
  private ended = false;
  private failure: Error | null = null;
  private notify: (() => void) | null = null;

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.notify?.();
    });
    socket.on("end", () => {
      this.ended = true;
      this.notify?.();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.notify?.();
    });
  }

  private wait(timeoutMs: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.notify = null;
        reject(new Error("Kamera zaman aşımına uğradı"));
      }, timeoutMs);
      this.notify = () => {
        clearTimeout(timer);
        this.notify = null;
        resolve();
      };
    });
  }

  async read(count: number, timeoutMs: number): Promise<Buffer> {
    while (this.buf.length < count) {
      if (this.failure) throw this.failure;
      if (this.ended) throw new Error("Kamera bağlantıyı kapattı");
      await this.wait(timeoutMs);
    }
    const out = this.buf.subarray(0, count);
    this.buf = this.buf.subarray(count);
    return Buffer.from(out);
  }

  async readHeader(timeoutMs: number): Promise<{ status: number; headers: Map<string, string>; raw: string }> {
    const marker = Buffer.from("\r\n\r\n");
    for (;;) {
      const index = this.buf.indexOf(marker);
      if (index >= 0) {
        const raw = this.buf.subarray(0, index).toString("utf8");
        this.buf = this.buf.subarray(index + marker.length);
        const lines = raw.split("\r\n");
        const statusLine = lines[0] ?? "";
        const status = Number(statusLine.split(" ")[1] ?? 0);
        const headers = new Map<string, string>();
        for (const line of lines.slice(1)) {
          const split = line.indexOf(":");
          if (split > 0) headers.set(line.slice(0, split).toLowerCase(), line.slice(split + 1).trim());
        }
        return { status, headers, raw };
      }
      if (this.failure) throw this.failure;
      if (this.ended) throw new Error("Kamera bağlantıyı kapattı");
      await this.wait(timeoutMs);
    }
  }

  async readJsonSession(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let text = "";
    while (Date.now() < deadline) {
      if (this.buf.length > 0) {
        text += this.buf.toString("utf8");
        this.buf = Buffer.alloc(0);
        const session = extractSession(text);
        if (session) return session;
      }
      if (this.failure) throw this.failure;
      if (this.ended) break;
      await this.wait(Math.max(200, deadline - Date.now()));
    }
    throw new Error("Kameradan konuşma oturumu gelmedi");
  }
}

function extractSession(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
    if (depth !== 0) continue;
    try {
      const parsed = JSON.parse(text.slice(start, i + 1)) as {
        error_code?: number;
        params?: { session_id?: string; sessionId?: string };
      };
      if (parsed.error_code && parsed.error_code !== 0) {
        throw new Error(`Kamera konuşma isteğini reddetti (${parsed.error_code})`);
      }
      return parsed.params?.session_id ?? parsed.params?.sessionId ?? null;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
  return null;
}

function openSocket(endpoint: Endpoint, signal?: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Çalma durduruldu"));
      return;
    }
    const socket = connect({ host: endpoint.hostname, port: endpoint.port, family: 4 });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    const onAbort = () => fail(new Error("Çalma durduruldu"));
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("connect", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(socket);
    });
    socket.once("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(
        new Error(
          `Kameraya ulaşılamadı (${endpoint.hostname}:${endpoint.port}). C210 ev ağında ve 8800 portu açık olmalı.`,
        ),
      );
      void error;
    });
    socket.setTimeout(10_000, () => fail(new Error("Kameraya bağlanırken zaman aşımı")));
  });
}

function httpRequest(input: {
  host: string;
  authorization?: string;
}): Buffer {
  const lines = [
    "POST /stream HTTP/1.1",
    `Host: ${input.host}`,
    "User-Agent: tapo-ses",
    "Content-Type: multipart/mixed; boundary=--client-stream-boundary--",
    "Content-Length: 0",
    "Connection: keep-alive",
  ];
  if (input.authorization) lines.push(`Authorization: ${input.authorization}`);
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "utf8");
}

function jsonPart(json: string): Buffer {
  const body = Buffer.from(json, "utf8");
  const head =
    "----client-stream-boundary--\r\n" +
    "Content-Type: application/json\r\n" +
    `Content-Length: ${body.length}\r\n\r\n`;
  return Buffer.concat([Buffer.from(head, "utf8"), body, Buffer.from("\r\n")]);
}

function clientPart(headers: Record<string, string>, body: Buffer | string): Buffer {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const head = [
    "----client-stream-boundary--",
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    `Content-Length: ${payload.length}`,
    "",
    "",
  ].join("\r\n");
  return Buffer.concat([Buffer.from(head, "utf8"), payload]);
}

async function discardBody(pump: BytePump, headers: Map<string, string>): Promise<void> {
  const length = headers.get("content-length");
  if (length && Number(length) > 0) {
    await pump.read(Number(length), 8000);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Çalma durduruldu"));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error("Çalma durduruldu"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Push already-encoded 8 kHz mono PCMA into a Tapo camera speaker.
 * C210 uses this same talk session (`mode: aec`) as the other two-way Tapo models.
 */
export async function playAlawOnTapo(
  target: TapoTalkTarget,
  alaw: Buffer,
  options?: {
    signal?: AbortSignal;
    onProgress?: (progress: TalkProgress) => void;
  },
): Promise<{ durationMs: number; bytes: number }> {
  if (!target.password) throw new Error("Bulut şifresi gerekli");
  if (alaw.length === 0) throw new Error("Ses dosyası boş");

  const endpoint = parseCameraHost(target.host);
  const hostHeader = `${endpoint.hostname}:${endpoint.port}`;
  const socket = await openSocket(endpoint, options?.signal);
  socket.setTimeout(0);
  const pump = new BytePump(socket);

  try {
    socket.write(httpRequest({ host: hostHeader }));
    const first = await pump.readHeader(8000);
    if (first.status !== 401) {
      throw new Error(`Kamera beklenen kimlik doğrulamasını vermedi (${first.status || "yanıt yok"})`);
    }
    await discardBody(pump, first.headers);

    const www = first.headers.get("www-authenticate") ?? "";
    if (!www.toLowerCase().startsWith("digest")) {
      throw new Error("Kamera Digest kimlik doğrulaması istemiyor");
    }
    const challenge = parseDigestChallenge(www);
    const password = target.passwordIsHash
      ? target.password.trim()
      : hashCloudPassword(target.password, challenge.encryptType);
    const authorization = buildDigestAuthorization({
      username: "admin",
      password,
      method: "POST",
      uri: "/stream",
      challenge,
    });

    if ((first.headers.get("connection") ?? "").toLowerCase() === "close") {
      throw new Error("Kamera bağlantıyı kapatıyor; tekrar deneyin");
    }

    socket.write(httpRequest({ host: hostHeader, authorization }));
    const authed = await pump.readHeader(8000);
    if (authed.status === 401) {
      throw new Error("Bulut şifresi kabul edilmedi. RTSP şifresi değil, Tapo hesap şifresi gerekli.");
    }
    if (authed.status !== 200) {
      throw new Error(`Kamera akışı açılmadı (${authed.status})`);
    }
    await discardBody(pump, authed.headers);

    const talk = '{"params":{"talk":{"mode":"aec"},"method":"get"},"seq":3,"type":"request"}';
    socket.write(jsonPart(talk));
    const session = await pump.readJsonSession(8000);

    const muxer = new PcmaMuxer();
    const pid = muxer.addTrack();
    const header = muxer.getHeader();
    assertTsPackets(header);
    socket.write(
      clientPart(
        {
          "Content-Type": "audio/mp2t",
          "X-If-Encrypt": "0",
          "X-Session-Id": session,
        },
        header,
      ),
    );

    const silence = Buffer.alloc(FRAME_BYTES, 0xd5);
    const padded = Buffer.concat([
      alaw,
      silence.subarray(0, (FRAME_BYTES - (alaw.length % FRAME_BYTES)) % FRAME_BYTES),
      silence,
    ]);
    const totalFrames = padded.length / FRAME_BYTES;
    const started = Date.now();

    for (let frame = 0; frame < totalFrames; frame++) {
      if (options?.signal?.aborted) throw new Error("Çalma durduruldu");
      const slice = padded.subarray(frame * FRAME_BYTES, (frame + 1) * FRAME_BYTES);
      const packet = muxer.getPayload(pid, (frame + 1) * FRAME_BYTES, slice);
      assertTsPackets(packet);
      const part = clientPart(
        {
          "Content-Type": "audio/mp2t",
          "X-If-Encrypt": "0",
          "X-Session-Id": session,
        },
        packet,
      );
      if (!socket.write(part)) {
        await new Promise<void>((resolve) => socket.once("drain", () => resolve()));
      }
      options?.onProgress?.({ sentFrames: frame + 1, totalFrames });
      const elapsed = ((frame + 1) * FRAME_BYTES * 1000) / SAMPLE_RATE;
      await sleep(started + elapsed - Date.now(), options?.signal);
    }

    return { durationMs: Math.round((padded.length / SAMPLE_RATE) * 1000), bytes: padded.length };
  } finally {
    socket.destroy();
  }
}
