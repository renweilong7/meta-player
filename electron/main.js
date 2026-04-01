const { app, BrowserWindow, Menu } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
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
