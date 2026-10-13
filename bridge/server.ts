import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { corsHeaders } from "../lib/server/cors";
import { fieldsFromMap, parseMultipart, performPlay, performStop } from "../lib/server/playback";
import { ffmpegAvailable } from "../lib/tapo/transcode";

const port = Number(process.env.BRIDGE_PORT || 8787);
const host = process.env.BRIDGE_HOST || "0.0.0.0";

function readBody(req: IncomingMessage, limit = 12_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Dosya 8 MB sınırını aşıyor."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body: Record<string, unknown> | null) {
  const headers = {
    ...corsHeaders(req.headers.origin ?? null),
    "Content-Type": "application/json; charset=utf-8",
  };
  res.writeHead(status, headers);
  res.end(body ? JSON.stringify(body) : "");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://bridge.local");
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req.headers.origin ?? null));
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    send(req, res, 200, {
      ok: true,
      cloud: false,
      playback: true,
      ffmpeg: ffmpegAvailable(),
      codec: "PCMA/8000",
      role: "bridge",
    });
    return;
  }

  if (url.pathname === "/api/play" && req.method === "POST") {
    try {
      const type = req.headers["content-type"] ?? "";
      const body = await readBody(req);
      const fields = fieldsFromMap(parseMultipart(body, type));
      const abort = new AbortController();
      req.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const result = await performPlay(req.headers.authorization ?? null, fields, abort.signal);
      send(req, res, result.status, result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ses çalınamadı";
      send(req, res, 400, { error: message });
    }
    return;
  }

  if (url.pathname === "/api/play" && req.method === "DELETE") {
    const result = performStop(req.headers.authorization ?? null, url.searchParams.get("host") ?? "");
    send(req, res, result.status, result.body);
    return;
  }

  send(req, res, 404, { error: "Bu köprü yalnız /api/health ve /api/play sunar." });
});

server.listen(port, host, () => {
  console.log(`Tapo köprüsü http://${host}:${port} üzerinde dinliyor`);
});
