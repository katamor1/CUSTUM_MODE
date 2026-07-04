import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings, DiffRepoApi, StartJobRequest } from "../shared/ipcTypes";
import type { ReportProgress } from "../core/reportJob";

const api: DiffRepoApi = {
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  selectDirectory: () => ipcRenderer.invoke("dialog:select-directory"),
  selectExecutable: (title: string) => ipcRenderer.invoke("dialog:select-executable", title),
  selectWorkbookOutput: () => ipcRenderer.invoke("dialog:select-workbook-output"),
  selectPathTestWorkbookOutput: () => ipcRenderer.invoke("dialog:select-path-test-workbook-output"),
  selectChangeListOutput: () => ipcRenderer.invoke("dialog:select-change-list-output"),
  isDirectory: (path: string) => ipcRenderer.invoke("path:is-directory", path),
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),
  startJob: (request: StartJobRequest) => ipcRenderer.invoke("job:start", request),
  cancelJob: () => ipcRenderer.invoke("job:cancel"),
  onProgress: (callback: (progress: ReportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ReportProgress): void => {
      callback(progress);
    };
    ipcRenderer.on("job:progress", listener);
    return () => {
      ipcRenderer.removeListener("job:progress", listener);
    };
  }
};

contextBridge.exposeInMainWorld("diffRepo", api);
