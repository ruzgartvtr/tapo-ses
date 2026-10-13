import { PlayBusyError, TokenError, assertBridgeToken, playAudioFile, stopPlayback } from "../tapo/play";

export type PlayFields = {
  host: string;
  password: string;
  passwordIsHash: boolean;
  volume: number;
  file: Buffer;
};

export function isCloudRuntime(): boolean {
  return Boolean(process.env.VERCEL);
}

export async function performPlay(
  authorization: string | null,
  fields: PlayFields,
  signal?: AbortSignal,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (isCloudRuntime()) {
    return {
      status: 501,
      body: {
        error:
          "Vercel ev ağınızdaki kameraya bağlanamaz. Arayüz buradan yönetilir; ses, evde çalışan köprüden çıkar.",
      },
    };
  }

  try {
    assertBridgeToken(authorization, process.env.BRIDGE_TOKEN);
  } catch (error) {
    if (error instanceof TokenError) return { status: 401, body: { error: error.message } };
    throw error;
  }

  if (!fields.host.trim() || !fields.password || fields.file.length === 0) {
    return { status: 400, body: { error: "Kamera adresi, bulut şifresi ve bir ses dosyası gerekli." } };
  }
  if (fields.file.length > 8_000_000) {
    return { status: 400, body: { error: "Dosya 8 MB sınırını aşıyor." } };
  }

  try {
    const result = await playAudioFile(
      {
        host: fields.host,
        password: fields.password,
        passwordIsHash: fields.passwordIsHash,
        volume: fields.volume,
        file: fields.file,
      },
      signal,
    );
    return {
      status: 200,
      body: {
        ok: true,
        codec: result.codec,
        durationMs: result.durationMs,
        truncated: result.truncated,
      },
    };
  } catch (error) {
    if (error instanceof PlayBusyError) return { status: 409, body: { error: error.message } };
    const message = error instanceof Error ? error.message : "Ses çalınamadı";
    const status = /ulaşılamadı|zaman aşımı|kabul edilmedi|reddetti/.test(message) ? 502 : 400;
    return { status, body: { error: message } };
  }
}

export function performStop(authorization: string | null, host: string): { status: number; body: Record<string, unknown> } {
  if (isCloudRuntime()) {
    return { status: 501, body: { error: "Durdurma yalnız evdeki köprüde çalışır." } };
  }
  try {
    assertBridgeToken(authorization, process.env.BRIDGE_TOKEN);
  } catch (error) {
    if (error instanceof TokenError) return { status: 401, body: { error: error.message } };
    throw error;
  }
  return { status: 200, body: { ok: true, stopped: stopPlayback(host) } };
}

export function parseMultipart(body: Buffer, contentType: string): Map<string, { filename?: string; data: Buffer }> {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.[1]
    ?? /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.[2];
  if (!boundary) throw new Error("Ses isteğinin sınırı okunamadı");
  const delim = Buffer.from(`--${boundary}`);
  const fields = new Map<string, { filename?: string; data: Buffer }>();
  let cursor = 0;
  while (cursor < body.length) {
    const at = body.indexOf(delim, cursor);
    if (at < 0) break;
    const next = body.indexOf(delim, at + delim.length);
    const slice = body.subarray(at + delim.length, next < 0 ? body.length : next);
    cursor = next < 0 ? body.length : next;
    let chunk = slice;
    if (chunk.subarray(0, 2).toString("utf8") === "\r\n") chunk = chunk.subarray(2);
    if (chunk.subarray(0, 2).toString("utf8") === "--" || chunk.length === 0) continue;
    const sep = chunk.indexOf("\r\n\r\n");
    if (sep < 0) continue;
    const head = chunk.subarray(0, sep).toString("utf8");
    let data = chunk.subarray(sep + 4);
    if (data.length >= 2 && data.subarray(-2).toString("utf8") === "\r\n") data = data.subarray(0, -2);
    const name = /name="([^"]+)"/.exec(head)?.[1];
    if (!name) continue;
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    fields.set(name, { filename, data });
  }
  return fields;
}

export function fieldsFromMap(fields: Map<string, { data: Buffer }>): PlayFields {
  const text = (name: string) => fields.get(name)?.data.toString("utf8").trim() ?? "";
  const volume = Number(text("volume") || "100");
  return {
    host: text("host"),
    password: text("password"),
    passwordIsHash: text("passwordIsHash") === "1" || text("passwordIsHash") === "true",
    volume: Number.isFinite(volume) ? volume : 100,
    file: fields.get("file")?.data ?? Buffer.alloc(0),
  };
}
