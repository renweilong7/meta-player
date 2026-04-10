const { contextBridge, ipcRenderer } = require("electron");

const desktopBridge = {
  chooseExportPath: (defaultPath) =>
    ipcRenderer.invoke("meta-player:choose-export-path", defaultPath),
  chooseDirectory: (defaultPath) =>
    ipcRenderer.invoke("meta-player:choose-directory", defaultPath),
  saveFile: (targetPath, bytes) =>
    ipcRenderer.invoke("meta-player:save-file", targetPath, bytes),
  openPath: (targetPath) => ipcRenderer.invoke("meta-player:open-path", targetPath),
  openExternal: (targetUrl) =>
    ipcRenderer.invoke("meta-player:open-external", targetUrl),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("metaPlayerDesktop", desktopBridge);
} else {
  window.metaPlayerDesktop = desktopBridge;
}
