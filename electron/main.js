const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const isDev = !app.isPackaged;
const PRODUCTION_PORT = process.env.PORT || "3232";
const PRODUCTION_HOST = "127.0.0.1";

let nextServerProcess = null;

const resolveProductionServerPath = () => {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, "server", "server.js"),
    path.join(appPath, "dist", "app", "server", "server.js"),
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Unable to locate production server bundle from ${appPath}`);
  }

  return resolved;
};

const waitForServer = (url, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(attempt, 250);
      });
    };

    attempt();
  });

const startProductionServer = async () => {
  if (nextServerProcess) {
    return `http://${PRODUCTION_HOST}:${PRODUCTION_PORT}`;
  }

  const serverPath = resolveProductionServerPath();
  nextServerProcess = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOSTNAME: PRODUCTION_HOST,
      PORT: String(PRODUCTION_PORT),
      META_PLAYER_DATA_DIR: path.join(app.getPath("userData"), ".meta-player"),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });

  nextServerProcess.on("exit", () => {
    nextServerProcess = null;
  });

  const url = `http://${PRODUCTION_HOST}:${PRODUCTION_PORT}`;
  await waitForServer(url);
  return url;
};

const applyProductionWindowHardening = (mainWindow) => {
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const openDevToolsShortcut =
      key === "f12" ||
      ((input.control || input.meta) &&
        input.shift &&
        ["i", "j", "c"].includes(key));

    if (openDevToolsShortcut) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("context-menu", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: "deny",
  }));
};

const createWindow = async () => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: isDev,
      contextIsolation: !isDev,
      devTools: isDev,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (!isDev) {
    applyProductionWindowHardening(mainWindow);
  }

  const url = isDev
    ? "http://localhost:3000"
    : await startProductionServer();

  await mainWindow.loadURL(url);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
};

app.whenReady().then(() => {
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  ipcMain.handle("meta-player:choose-export-path", async (_event, defaultPath) => {
    const browserWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(browserWindow ?? undefined, {
      title: "导出成片",
      defaultPath: typeof defaultPath === "string" && defaultPath.trim() ? defaultPath : undefined,
      filters: [
        { name: "MP4 视频", extensions: ["mp4"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return result.filePath;
  });

  ipcMain.handle("meta-player:choose-directory", async (_event, defaultPath) => {
    const browserWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(browserWindow ?? undefined, {
      title: "选择目录",
      defaultPath: typeof defaultPath === "string" && defaultPath.trim() ? defaultPath : undefined,
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("meta-player:open-path", async (_event, targetPath) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) {
      return "";
    }

    return shell.showItemInFolder(targetPath);
  });

  ipcMain.handle("meta-player:save-file", async (_event, targetPath, bytes) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) {
      throw new Error("缺少导出路径。");
    }

    const parentDirectory = path.dirname(targetPath);
    mkdirSync(parentDirectory, { recursive: true });
    writeFileSync(targetPath, Buffer.from(bytes));
    return targetPath;
  });

  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (nextServerProcess) {
    nextServerProcess.kill();
    nextServerProcess = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
