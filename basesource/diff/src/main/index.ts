import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, utilityProcess } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { isStartJobRequest, type AppSettings } from "../shared/ipcTypes";
import { DEFAULT_APP_SETTINGS } from "../shared/settings";
import { JobManager } from "./jobManager";
import { isTrustedRendererUrl, selectDevRendererUrl } from "./rendererTrust";
import { loadSettingsFile, saveSettingsFile } from "./settings";
import { createCloseCoordinator } from "./windowClose";

const jobManager = new JobManager({
  createProcess: () => utilityProcess.fork(
    path.join(__dirname, "../worker/index.js"),
    [],
    { serviceName: "DiffRepo Report Worker" }
  )
});
const appCloseCoordinator = createCloseCoordinator({
  hasActiveJob: () => jobManager.hasActiveJob(),
  cancel: () => jobManager.cancel(),
  finalizeClose: () => app.quit()
});

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: "差分レポート作成",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  const windowCloseCoordinator = createCloseCoordinator({
    hasActiveJob: () => jobManager.hasActiveJob(),
    cancel: () => jobManager.cancel(),
    finalizeClose: () => mainWindow.destroy()
  });
  mainWindow.on("close", (event) => {
    void windowCloseCoordinator.handleClose(event);
  });

  const devRendererUrl = selectDevRendererUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged);
  if (devRendererUrl) {
    void mainWindow.loadURL(devRendererUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  void appCloseCoordinator.handleClose(event);
});

function registerIpcHandlers(): void {
  trustedHandle("settings:load", async () => {
    return loadSettings();
  });

  trustedHandle("settings:save", async (_event, settings: AppSettings) => {
    await saveSettings(settings);
  });

  trustedHandle("dialog:select-directory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });

  trustedHandle("dialog:select-executable", async (_event, title: string) => {
    const result = await dialog.showOpenDialog({
      title: typeof title === "string" ? title : "実行ファイルを選択",
      properties: ["openFile"],
      filters: [{ name: "実行ファイル", extensions: ["exe", "cmd", "bat", "*"] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  trustedHandle("dialog:select-workbook-output", async () => {
    const settings = await loadSettings();
    const result = await dialog.showSaveDialog({
      title: "Excelブックの保存先",
      defaultPath: settings.lastOutputDirectory ? path.join(settings.lastOutputDirectory, "diff-report.xlsx") : "diff-report.xlsx",
      filters: [{ name: "Excelブック", extensions: ["xlsx"] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }

    await saveSettings({ ...settings, lastOutputDirectory: path.dirname(result.filePath) });
    return result.filePath;
  });

  trustedHandle("dialog:select-path-test-workbook-output", async () => {
    const settings = await loadSettings();
    const result = await dialog.showSaveDialog({
      title: "パステストExcelの保存先",
      defaultPath: settings.lastOutputDirectory
        ? path.join(settings.lastOutputDirectory, "path-test-report.xlsx")
        : "path-test-report.xlsx",
      filters: [{ name: "Excelブック", extensions: ["xlsx"] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }

    await saveSettings({ ...settings, lastOutputDirectory: path.dirname(result.filePath) });
    return result.filePath;
  });

  trustedHandle("dialog:select-change-list-output", async () => {
    const settings = await loadSettings();
    const result = await dialog.showSaveDialog({
      title: "Word変更一覧の保存先",
      defaultPath: settings.lastOutputDirectory ? path.join(settings.lastOutputDirectory, "diff-change-list.docx") : "diff-change-list.docx",
      filters: [{ name: "Word文書", extensions: ["docx"] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }

    await saveSettings({ ...settings, lastOutputDirectory: path.dirname(result.filePath) });
    return result.filePath;
  });

  trustedHandle("path:is-directory", async (_event, candidatePath: string) => {
    if (typeof candidatePath !== "string" || candidatePath.length === 0) {
      return false;
    }
    try {
      return (await stat(candidatePath)).isDirectory();
    } catch {
      return false;
    }
  });

  trustedHandle("job:start", async (event, request: unknown) => {
    if (!isStartJobRequest(request)) {
      throw new Error("ジョブ要求が不正です。");
    }
    return jobManager.start(
      request,
      (progress) => event.sender.send("job:progress", progress),
      event.sender.id
    );
  });

  trustedHandle("job:cancel", async (event) => {
    await jobManager.cancel(event.sender.id);
  });
}

function trustedHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedRenderer(event);
    return handler(event, ...args);
  });
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  if (!isTrustedRendererUrl(
    event.senderFrame?.url,
    process.env.ELECTRON_RENDERER_URL,
    app.isPackaged
  )) {
    throw new Error("信頼できない画面からの操作は許可されません。");
  }
}

async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  const defaultWinMerge = findDefaultWinMergePath();
  const defaults = { ...DEFAULT_APP_SETTINGS, winMergePath: defaultWinMerge ?? "" };
  return loadSettingsFile(settingsPath, defaults);
}

async function saveSettings(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  const defaultWinMerge = findDefaultWinMergePath();
  const defaults = { ...DEFAULT_APP_SETTINGS, winMergePath: defaultWinMerge ?? "" };
  await saveSettingsFile(settingsPath, settings, defaults);
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function findDefaultWinMergePath(): string | null {
  const candidates = [
    "C:\\Program Files\\WinMerge\\WinMergeU.exe",
    "C:\\Program Files (x86)\\WinMerge\\WinMergeU.exe"
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
