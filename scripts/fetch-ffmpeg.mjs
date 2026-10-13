import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destRoot = path.join(root, "vendor", "ffmpeg");
const packages = [
  ["@ffmpeg-installer/win32-x64", "win32-x64", "ffmpeg.exe"],
  ["@ffmpeg-installer/darwin-x64", "darwin-x64", "ffmpeg"],
  ["@ffmpeg-installer/darwin-arm64", "darwin-arm64", "ffmpeg"],
];

mkdirSync(destRoot, { recursive: true });
const cache = path.join(root, "vendor", ".cache");
mkdirSync(cache, { recursive: true });

for (const [pkg, folder, filename] of packages) {
  const target = path.join(destRoot, folder, filename);
  if (existsSync(target)) continue;
  const packed = execFileSync("npm", ["pack", pkg, "--silent"], { cwd: cache, encoding: "utf8" }).trim().split("\n").pop();
  const archive = path.join(cache, packed);
  const extract = path.join(cache, folder);
  rmSync(extract, { recursive: true, force: true });
  mkdirSync(extract, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", extract]);
  mkdirSync(path.dirname(target), { recursive: true });
  execFileSync("mv", [path.join(extract, "package", filename), target]);
  if (!filename.endsWith(".exe")) chmodSync(target, 0o755);
  console.log(`ffmpeg hazır: ${path.relative(root, target)}`);
}
