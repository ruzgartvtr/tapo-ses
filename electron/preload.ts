import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tapo", {
  health: () => ipcRenderer.invoke("tapo:health"),
  connect: (payload: { email: string; password: string; code?: string }) => ipcRenderer.invoke("tapo:connect", payload),
  stop: (host: string) => ipcRenderer.invoke("tapo:stop", host),
  play: (payload: unknown) => ipcRenderer.invoke("tapo:play", payload),
});
