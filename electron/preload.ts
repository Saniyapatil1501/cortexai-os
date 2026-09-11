// @ts-ignore
const { contextBridge, ipcRenderer } = require("electron");

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
  
  // Lens APIs
  startLens: () => ipcRenderer.invoke("lens:start"),
  getLensScreenshot: () => ipcRenderer.invoke("lens:get-screenshot"),
  completeLens: (croppedBase64: string) => ipcRenderer.send("lens:complete", croppedBase64),
  cancelLens: () => ipcRenderer.send("lens:cancel"),

  // Companion APIs
  showCompanionWidget: () => ipcRenderer.send("companion:show"),
  hideCompanionWidget: () => ipcRenderer.send("companion:hide"),
  resizeCompanionWidget: (expanded: boolean) => ipcRenderer.send("companion:resize", expanded),
  showCompanionContextMenu: () => ipcRenderer.send("companion:context-menu"),
  onCompanionAction: (callback: (action: string, data?: any) => void) => {
    ipcRenderer.on("companion:action", (_: any, action: string, data: any) => callback(action, data));
  },
});
