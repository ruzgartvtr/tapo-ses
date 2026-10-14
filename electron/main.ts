import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import { performPlay, performStop } from "../lib/server/playback";
import { connectTapoAccount } from "../lib/tapo/cloud";
import { ffmpegAvailable } from "../lib/tapo/transcode";

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

type PlayPayload = {
  host: string;
  password: string;
  passwordIsHash?: boolean;
  volume?: number;
  file: Uint8Array;
};

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 860,
    minHeight: 640,
    backgroundColor: "#eceae4",
    title: "Tapo Ses",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, "../dist/index.html"));
}

function useBundledFfmpeg() {
  const filename = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const folder = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(process.resourcesPath, "ffmpeg", folder, filename),
    path.join(app.getAppPath(), "vendor", "ffmpeg", folder, filename),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (match) process.env.FFMPEG_PATH = match;
}

app.whenReady().then(() => {
  useBundledFfmpeg();
  ipcMain.handle("tapo:health", () => ({ ffmpeg: ffmpegAvailable() }));
  ipcMain.handle("tapo:connect", (_event, payload: { email?: string; password?: string; code?: string }) =>
    connectTapoAccount({
      email: payload?.email ?? "",
      password: payload?.password ?? "",
      code: payload?.code,
    }),
  );
  ipcMain.handle("tapo:stop", (_event, host: string) => performStop(null, host ?? ""));
  ipcMain.handle("tapo:play", async (_event, payload: PlayPayload) => {
    const result = await performPlay(null, {
      host: payload.host,
      password: payload.password,
      passwordIsHash: Boolean(payload.passwordIsHash),
      volume: payload.volume ?? 100,
      file: Buffer.from(payload.file),
    });
    if (result.status >= 400) throw new Error(String(result.body.error ?? "Ses çalınamadı"));
    return result.body;
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});
