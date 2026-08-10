import { contextBridge, ipcRenderer } from "electron";

// Expose safe, selected functions to the renderer context (React frontend)
contextBridge.exposeInMainWorld("cortexAPI", {
  sendNotification: (title: string, body: string) => {
    return ipcRenderer.invoke("notification:trigger", { title, body });
  },
  onFocusTrigger: (callback: () => void) => {
    ipcRenderer.on("focus:trigger", () => callback());
  },
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  maximizeWindow: () => ipcRenderer.send("window:maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
});
