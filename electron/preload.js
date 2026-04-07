const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("metaPlayerDesktop", {
  chooseExportPath: (defaultPath) =>
    ipcRenderer.invoke("meta-player:choose-export-path", defaultPath),
  chooseDirectory: (defaultPath) =>
    ipcRenderer.invoke("meta-player:choose-directory", defaultPath),
  saveFile: (targetPath, bytes) =>
    ipcRenderer.invoke("meta-player:save-file", targetPath, bytes),
  openPath: (targetPath) => ipcRenderer.invoke("meta-player:open-path", targetPath),
});
