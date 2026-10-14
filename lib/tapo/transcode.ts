import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const MAX_SECONDS = 90;
const SAMPLE_RATE = 8000;

export function ffmpegBinary(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  return "ffmpeg";
}

export function ffmpegAvailable(): boolean {
  try {
    const result = spawnSync(ffmpegBinary(), ["-version"], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export async function transcodeToAlaw(input: Buffer): Promise<{ audio: Buffer; truncated: boolean }> {
  const binary = ffmpegBinary();
  if (!ffmpegAvailable()) {
    throw new Error("Audio engine missing. Reinstall the app.");
  }

  const audio = await new Promise<Buffer>((resolve, reject) => {
    const ffmpeg = spawn(
      binary,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-f",
        "alaw",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    ffmpeg.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    ffmpeg.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    ffmpeg.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const detail = Buffer.concat(err)
          .toString("utf8")
          .split("\n")
          .filter((line) => line.trim() && !line.includes("no version information"))
          .join(" ")
          .trim();
        reject(
          new Error(
            /Invalid data|Error opening input|Invalid argument/.test(detail)
              ? "Ses dosyası çözülemedi. MP3, WAV, M4A veya OGG deneyin."
              : detail.slice(0, 220) || "Ses dosyası çözülemedi. MP3, WAV, M4A veya OGG deneyin.",
          ),
        );
        return;
      }
      resolve(Buffer.concat(out));
    });
    ffmpeg.stdin.on("error", () => undefined);
    ffmpeg.stdin.end(input);
  });

  const maxBytes = MAX_SECONDS * SAMPLE_RATE;
  if (audio.length > maxBytes) {
    return { audio: audio.subarray(0, maxBytes), truncated: true };
  }
  return { audio, truncated: false };
}
