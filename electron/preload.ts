import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tapo", {
  health: () => ipcRenderer.invoke("tapo:health"),
  stop: (host: string) => ipcRenderer.invoke("tapo:stop", host),
  play: (payload: unknown) => ipcRenderer.invoke("tapo:play", payload),
});
