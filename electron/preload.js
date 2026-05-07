const { contextBridge, ipcRenderer } = require("electron");

const desktopBridge = {
  chooseExportPath: (defaultPath) =>
    ipcRenderer.invoke("meta-player:choose-export-path", defaultPath),
  chooseDirectory: (defaultPath) =>
    ipcRenderer.invoke("meta-player:choose-directory", defaultPath),
  chooseFile: (defaultPath, filters) =>
    ipcRenderer.invoke("meta-player:choose-file", defaultPath, filters),
  saveFile: (targetPath, bytes) =>
    ipcRenderer.invoke("meta-player:save-file", targetPath, bytes),
  openPath: (targetPath) => ipcRenderer.invoke("meta-player:open-path", targetPath),
  exportDiagnostics: () => ipcRenderer.invoke("meta-player:export-diagnostics"),
  openExternal: (targetUrl) =>
    ipcRenderer.invoke("meta-player:open-external", targetUrl),
  testBrowserCdp: (input) => ipcRenderer.invoke("meta-player:test-browser-cdp", input),
  launchBrowserCdp: (input) => ipcRenderer.invoke("meta-player:launch-browser-cdp", input),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("metaPlayerDesktop", desktopBridge);
} else {
  window.metaPlayerDesktop = desktopBridge;
}
