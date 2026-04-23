const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const isDev = !app.isPackaged;
const PRODUCTION_PORT = process.env.PORT || "3232";
const PRODUCTION_HOST = "127.0.0.1";

let productionServerStartupPromise = null;
let productionHttpServer = null;

const getDefaultAppDataDirectory = () => path.join(process.cwd(), ".meta-player");

const getAppDataDirectory = () =>
  (process.env.META_PLAYER_DATA_DIR || getDefaultAppDataDirectory()).trim();

const getStartupLogPath = () =>
  path.join(app.getPath("userData"), "startup.log");

const getMainLogDirectory = () => path.join(getAppDataDirectory(), "logs");

const getMainLogPath = () => {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(getMainLogDirectory(), `electron-main-${date}.log`);
};

const writeMainLog = (level, event, context = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    runtime: "electron-main",
    context,
  };

  try {
    mkdirSync(getMainLogDirectory(), { recursive: true });
    appendFileSync(getMainLogPath(), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error("Failed to write main log:", error);
  }
};

const writeStartupLog = (message) => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;

  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    appendFileSync(getStartupLogPath(), line);
    writeMainLog("info", "startup.log", { message });
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
  writeMainLog("error", "startup.error", {
    title,
    detail,
  });

  if (!app.isReady()) {
    return;
  }

  dialog.showErrorBox(
    title,
    `${detail}\n\n启动日志位置：${getStartupLogPath()}`
  );
};

const resolveProductionAppRoot = () => {
  const appPath = app.getAppPath();
  const candidates = [
    appPath,
    path.join(process.resourcesPath, "app"),
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Unable to locate packaged app root from ${appPath}`);
  }

  writeStartupLog(`Resolved production app root: ${resolved}`);
  writeMainLog("info", "server.app_root_resolved", {
    resolved,
  });
  return resolved;
};

const startProductionServer = async () => {
  if (productionServerStartupPromise) {
    return productionServerStartupPromise;
  }

  productionServerStartupPromise = (async () => {
    const appRoot = resolveProductionAppRoot();
    const url = `http://${PRODUCTION_HOST}:${PRODUCTION_PORT}`;
    const next = require("next");

    writeStartupLog(`Starting production server from ${appRoot}`);
    writeMainLog("info", "server.starting", {
      appRoot,
      host: PRODUCTION_HOST,
      port: PRODUCTION_PORT,
    });

    process.env.NODE_ENV = "production";
    process.env.HOSTNAME = PRODUCTION_HOST;
    process.env.PORT = String(PRODUCTION_PORT);
    process.chdir(appRoot);

    const nextApp = next({
      dev: false,
      dir: appRoot,
      conf: {
        distDir: ".next",
      },
    });
    const requestHandler = nextApp.getRequestHandler();

    await nextApp.prepare();

    productionHttpServer = http.createServer((request, response) =>
      requestHandler(request, response)
    );

    await new Promise((resolve, reject) => {
      if (!productionHttpServer) {
        reject(new Error("Production HTTP server was not initialized."));
        return;
      }

      productionHttpServer.once("error", reject);
      productionHttpServer.listen(Number(PRODUCTION_PORT), PRODUCTION_HOST, () => {
        productionHttpServer?.removeListener("error", reject);
        resolve();
      });
    });

    writeStartupLog(`Production server is ready at ${url}`);
    writeMainLog("info", "server.ready", { url });
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }

    return {
      action: "deny",
    };
  });
};

const createWindow = async () => {
  writeStartupLog(`Creating window. isDev=${String(isDev)}`);
  writeMainLog("info", "window.creating", {
    isDev,
  });
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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
  writeMainLog("info", "window.loaded", { url });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
};

app.whenReady().then(() => {
  writeStartupLog("App is ready.");
  writeMainLog("info", "app.ready", {
    isDev,
    userDataPath: app.getPath("userData"),
    appDataDirectory: getAppDataDirectory(),
  });
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

  ipcMain.handle("meta-player:export-diagnostics", async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bundleDirectory = path.join(
      app.getPath("userData"),
      "diagnostics",
      `meta-player-diagnostics-${timestamp}`
    );
    const logsDirectory = path.join(bundleDirectory, "logs");

    mkdirSync(logsDirectory, { recursive: true });

    if (existsSync(getStartupLogPath())) {
      copyFileSync(getStartupLogPath(), path.join(logsDirectory, "startup.log"));
    }

    const structuredLogDirectory = getMainLogDirectory();
    if (existsSync(structuredLogDirectory)) {
      readdirSync(structuredLogDirectory).forEach((entry) => {
        const sourcePath = path.join(structuredLogDirectory, entry);
        const targetPath = path.join(logsDirectory, entry);
        copyFileSync(sourcePath, targetPath);
      });
    }

    writeFileSync(
      path.join(bundleDirectory, "metadata.json"),
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          appVersion: app.getVersion(),
          isPackaged: app.isPackaged,
          platform: process.platform,
          arch: process.arch,
          userDataPath: app.getPath("userData"),
          appDataDirectory: getAppDataDirectory(),
          logDirectory: structuredLogDirectory,
        },
        null,
        2
      )
    );

    writeMainLog("info", "diagnostics.exported", {
      bundleDirectory,
    });

    return bundleDirectory;
  });

  ipcMain.handle("meta-player:open-external", async (_event, targetUrl) => {
    if (typeof targetUrl !== "string" || !targetUrl.trim()) {
      throw new Error("缺少外部链接。");
    }

    return shell.openExternal(targetUrl);
  });

  ipcMain.handle("meta-player:save-file", async (_event, targetPath, bytes) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) {
      throw new Error("缺少导出路径。");
    }

    const parentDirectory = path.dirname(targetPath);
    mkdirSync(parentDirectory, { recursive: true });
    writeFileSync(targetPath, Buffer.from(bytes));
    writeMainLog("info", "file.saved", {
      targetPath,
      byteLength: Array.isArray(bytes) ? bytes.length : Buffer.from(bytes).length,
    });
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
  if (productionHttpServer) {
    productionHttpServer.close();
    productionHttpServer = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
