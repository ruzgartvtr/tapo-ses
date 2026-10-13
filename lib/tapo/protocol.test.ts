import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import test from "node:test";

import { alawToLinear, applyVolume, linearToAlaw } from "./alaw";
import { buildDigestAuthorization, hashCloudPassword, parseDigestChallenge } from "./digest";
import { PcmaMuxer, assertTsPackets } from "./mpegts";
import { playAlawOnTapo } from "./talk";
import { transcodeToAlaw } from "./transcode";

test("A-law silence and volume stay in range", () => {
  assert.equal(linearToAlaw(0), 0xd5);
  const loud = linearToAlaw(16000);
  const quiet = applyVolume(Buffer.from([loud]), 50);
  assert.ok(Math.abs(alawToLinear(quiet[0]!)) < Math.abs(alawToLinear(loud)));
});

test("PCMA MPEG-TS packets are 188 bytes and start with the sync byte", () => {
  const muxer = new PcmaMuxer();
  const pid = muxer.addTrack();
  const header = muxer.getHeader();
  assertTsPackets(header);
  assert.ok(header.length >= 188 * 2);

  const frame = Buffer.alloc(160, 0xd5);
  const packet = muxer.getPayload(pid, 160, frame);
  assertTsPackets(packet);
  assert.ok(packet.includes(0xc0));
});

test("cloud password hash follows Tapo MD5 and SHA256 rules", () => {
  assert.equal(hashCloudPassword("secret", "md5"), createHash("md5").update("secret").digest("hex").toUpperCase());
  assert.equal(hashCloudPassword("secret", "sha256").length, 64);
  const challenge = parseDigestChallenge(
    'Digest realm="tplink", nonce="abc", qop="auth", encrypt_type="3"',
  );
  assert.equal(challenge.encryptType, "sha256");
  assert.equal(challenge.realm, "tplink");
  const header = buildDigestAuthorization({
    username: "admin",
    password: "HASH",
    method: "POST",
    uri: "/stream",
    challenge,
    cnonce: "cnonce",
  });
  assert.match(header, /username="admin"/);
  assert.match(header, /uri="\/stream"/);
  assert.doesNotMatch(header, /secret/);
});

test("talk client authenticates and sends paced PCMA to a C210-style session", async () => {
  const password = "bulut-sifre";
  const hashed = hashCloudPassword(password, "md5");
  const challenge = parseDigestChallenge(
    'Digest realm="tplink", nonce="nonce-1", qop="auth", encrypt_type="1"',
  );
  const expected = buildDigestAuthorization({
    username: "admin",
    password: hashed,
    method: "POST",
    uri: "/stream",
    challenge,
    cnonce: "ignored",
  });
  const expectedResponse = /response="([a-f0-9]+)"/.exec(expected)?.[1];
  assert.ok(expectedResponse);

  let audioParts = 0;
  const server: Server = createServer((socket: Socket) => {
    let buf = Buffer.alloc(0);
    let authed = false;
    let sessionSent = false;
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!authed) {
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const head = buf.subarray(0, headerEnd).toString("utf8");
        buf = buf.subarray(headerEnd + 4);
        if (!head.includes("Authorization:")) {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\n" +
              'WWW-Authenticate: Digest realm="tplink", nonce="nonce-1", qop="auth", encrypt_type="1"\r\n' +
              "Content-Length: 0\r\n" +
              "Connection: keep-alive\r\n\r\n",
          );
          return;
        }
        const response = /response="([a-f0-9]+)"/.exec(head)?.[1];
        assert.equal(response?.length, 32);
        const cnonce = /cnonce="([^"]+)"/.exec(head)?.[1] ?? "";
        const recomputed = buildDigestAuthorization({
          username: "admin",
          password: hashed,
          method: "POST",
          uri: "/stream",
          challenge,
          cnonce,
        });
        assert.equal(response, /response="([a-f0-9]+)"/.exec(recomputed)?.[1]);
        assert.doesNotMatch(head, new RegExp(password));
        authed = true;
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n");
      }

      if (authed && !sessionSent && buf.includes("talk")) {
        sessionSent = true;
        const json = Buffer.from(
          '{"error_code":0,"params":{"session_id":"sess-c210"},"type":"response"}',
        );
        socket.write(
          "----device-stream-boundary--\r\n" +
            "Content-Type: application/json\r\n" +
            `Content-Length: ${json.length}\r\n\r\n` +
            json.toString("utf8"),
        );
      }

      const marker = Buffer.from("Content-Type: audio/mp2t");
      while (buf.includes(marker)) {
        const at = buf.indexOf(marker);
        const after = buf.indexOf("\r\n\r\n", at);
        if (after < 0) break;
        const length = Number(/Content-Length: (\d+)/.exec(buf.subarray(at, after).toString("utf8"))?.[1]);
        const start = after + 4;
        if (buf.length < start + length) break;
        const body = buf.subarray(start, start + length);
        assertTsPackets(body);
        audioParts += 1;
        buf = buf.subarray(start + length);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port yok");

  try {
    const result = await playAlawOnTapo(
      { host: `127.0.0.1:${address.port}`, password },
      Buffer.alloc(320, 0xd5),
    );
    assert.ok(result.durationMs >= 40);
    assert.ok(audioParts >= 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("ffmpeg turns a wav tone into 8 kHz PCMA", async () => {
  const sampleRate = 8000;
  const samples = 800;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000);
    pcm.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const { audio, truncated } = await transcodeToAlaw(Buffer.concat([header, pcm]));
  assert.equal(truncated, false);
  assert.ok(audio.length >= 700 && audio.length <= 900);
});
