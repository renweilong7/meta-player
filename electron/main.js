const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const isDev = !app.isPackaged;
const PRODUCTION_PORT = process.env.PORT || "3232";
const PRODUCTION_HOST = "127.0.0.1";

let productionServerStartupPromise = null;

const getStartupLogPath = () =>
  path.join(app.getPath("userData"), "startup.log");

const writeStartupLog = (message) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;

  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    appendFileSync(getStartupLogPath(), line);
  } catch (error) {
    console.error("Failed to write startup log:", error);
  }
};

const formatError = (error) => {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
};

const reportStartupError = (title, error) => {
  const detail = formatError(error);
  writeStartupLog(`${title}: ${detail}`);

  if (!app.isReady()) {
    return;
  }

  dialog.showErrorBox(
    title,
    `${detail}\n\n启动日志位置：${getStartupLogPath()}`
  );
};

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

  writeStartupLog(`Resolved production server path: ${resolved}`);
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
  if (productionServerStartupPromise) {
    return productionServerStartupPromise;
  }

  productionServerStartupPromise = (async () => {
    const serverPath = resolveProductionServerPath();
    const url = `http://${PRODUCTION_HOST}:${PRODUCTION_PORT}`;

    writeStartupLog(`Starting production server from ${serverPath}`);

    process.env.NODE_ENV = "production";
    process.env.HOSTNAME = PRODUCTION_HOST;
    process.env.PORT = String(PRODUCTION_PORT);
    process.env.META_PLAYER_DATA_DIR = path.join(app.getPath("userData"), ".meta-player");

    try {
      require(serverPath);
    } catch (error) {
      const resolvedServerPath = require.resolve(serverPath);
      delete require.cache[resolvedServerPath];
      throw error;
    }

    writeStartupLog(`Waiting for production server at ${url}`);
    await waitForServer(url);
    writeStartupLog(`Production server is ready at ${url}`);
    return url;
  })().catch((error) => {
    productionServerStartupPromise = null;
    throw error;
  });

  return productionServerStartupPromise;
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
  writeStartupLog(`Creating window. isDev=${String(isDev)}`);
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

  writeStartupLog(`Loading window URL: ${url}`);
  await mainWindow.loadURL(url);
  writeStartupLog(`Window URL loaded: ${url}`);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
};

app.whenReady().then(() => {
  writeStartupLog("App is ready.");
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

  void createWindow().catch((error) => {
    reportStartupError("Failed to create main window", error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("render-process-gone", (_event, webContents, details) => {
  writeStartupLog(
    `Renderer process gone. reason=${details.reason} exitCode=${details.exitCode}`
  );
});

app.on("child-process-gone", (_event, details) => {
  writeStartupLog(
    `Child process gone. type=${details.type} reason=${details.reason} name=${details.name ?? ""} serviceName=${details.serviceName ?? ""}`
  );
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("did-fail-load", (_loadEvent, errorCode, errorDescription, validatedURL) => {
    writeStartupLog(
      `Web contents failed to load. code=${errorCode} description=${errorDescription} url=${validatedURL}`
    );
  });
});

process.on("uncaughtException", (error) => {
  reportStartupError("Uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  reportStartupError("Unhandled rejection", reason);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
