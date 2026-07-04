import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GitBranch,
  Play,
  Settings,
  Square,
  Upload,
  X
} from "lucide-react";
import type { AppSettings } from "../../shared/ipcTypes";
import type { ReportProgress } from "../../core/reportJob";
import { DEFAULT_APP_SETTINGS } from "../../shared/settings";
import { resolveFirstDroppedDirectoryPath } from "./dropPath";
import { buildStartJobRequest } from "./jobRequestValidation";
import { focusFirstModalControl, trapModalTab } from "./modalFocus";
import { canUseSettings, isJobBusy } from "./runState";
import { parseNonNegativeIntegerText } from "./settingsValidation";
import { statusLabel, UI_TEXT, type UiRunState } from "./uiText";

type Mode = "folders" | "bazaar";

interface SettingsDraft {
  winMergePath: string;
  bazaarPath: string;
  cContextRows: string;
  cHideRetainedRows: boolean;
  otherContextRows: string;
  otherHideRetainedRows: boolean;
}

interface SettingsErrors {
  cContextRows?: string;
  otherContextRows?: string;
}

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("folders");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [leftFolder, setLeftFolder] = useState("");
  const [rightFolder, setRightFolder] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [leftRevision, setLeftRevision] = useState("");
  const [rightRevision, setRightRevision] = useState("");
  const [outputWorkbookPath, setOutputWorkbookPath] = useState("");
  const [outputPathTestWorkbookPath, setOutputPathTestWorkbookPath] = useState("");
  const [outputChangeListPath, setOutputChangeListPath] = useState("");
  const [runState, setRunState] = useState<UiRunState>("idle");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [progress, setProgress] = useState<ReportProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<SettingsErrors>({});
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const settingsWasOpen = useRef(false);

  useEffect(() => {
    let active = true;
    void window.diffRepo.loadSettings().then((loadedSettings) => {
      if (!active) {
        return;
      }
      setSettings(loadedSettings);
      setSettingsLoaded(true);
    }).catch((error: unknown) => {
      if (!active) {
        return;
      }
      setRunState("failed");
      setLog([UI_TEXT.log.error(error instanceof Error ? error.message : String(error))]);
    });
    const unsubscribe = window.diffRepo.onProgress((nextProgress) => {
      setProgress(nextProgress);
      setLog((current) => [`${nextProgress.phase}: ${nextProgress.message}`, ...current].slice(0, 80));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const background = backgroundRef.current;
    if (!background) {
      return;
    }

    const isOpen = settingsDraft !== null;
    background.inert = isOpen;
    if (isOpen) {
      background.setAttribute("aria-hidden", "true");
      settingsWasOpen.current = true;
    } else {
      background.removeAttribute("aria-hidden");
      if (settingsWasOpen.current) {
        settingsWasOpen.current = false;
        queueMicrotask(() => settingsButtonRef.current?.focus());
      }
    }
  }, [settingsDraft]);

  const busy = isJobBusy(runState);
  const editingEnabled = canUseSettings(settingsLoaded, runState);
  const jobRequest = useMemo(() => editingEnabled
    ? buildStartJobRequest({
      mode,
      settings,
      leftFolder,
      rightFolder,
      repoPath,
      leftRevision,
      rightRevision,
      outputWorkbookPath,
      outputPathTestWorkbookPath,
      outputChangeListPath
    })
    : undefined,
  [editingEnabled, leftFolder, mode, outputChangeListPath, outputPathTestWorkbookPath, outputWorkbookPath, repoPath, rightFolder, settings, leftRevision, rightRevision]);
  const canRun = jobRequest !== undefined;

  async function pickDirectory(setValue: (path: string) => void): Promise<void> {
    const selected = await window.diffRepo.selectDirectory();
    if (selected) {
      setValue(selected);
    }
  }

  async function pickWinMerge(): Promise<void> {
    const selected = await window.diffRepo.selectExecutable(UI_TEXT.actions.chooseWinMerge);
    if (selected) {
      setSettingsDraft((current) => current ? { ...current, winMergePath: selected } : current);
    }
  }

  async function pickBazaar(): Promise<void> {
    const selected = await window.diffRepo.selectExecutable(UI_TEXT.actions.chooseBazaar);
    if (selected) {
      setSettingsDraft((current) => current ? { ...current, bazaarPath: selected } : current);
    }
  }

  async function pickOutput(): Promise<void> {
    const selected = await window.diffRepo.selectWorkbookOutput();
    if (selected) {
      setOutputWorkbookPath(selected);
      setSettings(await window.diffRepo.loadSettings());
    }
  }

  async function pickChangeListOutput(): Promise<void> {
    const selected = await window.diffRepo.selectChangeListOutput();
    if (selected) {
      setOutputChangeListPath(selected);
      setSettings(await window.diffRepo.loadSettings());
    }
  }

  async function pickPathTestOutput(): Promise<void> {
    const selected = await window.diffRepo.selectPathTestWorkbookOutput();
    if (selected) {
      setOutputPathTestWorkbookPath(selected);
      setSettings(await window.diffRepo.loadSettings());
    }
  }

  function openSettings(): void {
    if (!editingEnabled) {
      return;
    }
    setSettingsDraft(createSettingsDraft(settings));
    setSettingsErrors({});
    setSettingsSaveError(null);
  }

  function closeSettings(): void {
    setSettingsDraft(null);
    setSettingsErrors({});
    setSettingsSaveError(null);
  }

  function updateSettingsDraft(patch: Partial<SettingsDraft>): void {
    setSettingsDraft((current) => current ? { ...current, ...patch } : current);
    setSettingsSaveError(null);
    setSettingsErrors((current) => ({
      ...current,
      cContextRows: patch.cContextRows === undefined ? current.cContextRows : undefined,
      otherContextRows: patch.otherContextRows === undefined ? current.otherContextRows : undefined
    }));
  }

  async function saveSettings(): Promise<void> {
    if (!settingsDraft) {
      return;
    }

    const cContextRows = parseNonNegativeIntegerText(settingsDraft.cContextRows);
    const otherContextRows = parseNonNegativeIntegerText(settingsDraft.otherContextRows);
    const nextErrors: SettingsErrors = {
      cContextRows: cContextRows === undefined ? UI_TEXT.settings.invalidContextRows : undefined,
      otherContextRows: otherContextRows === undefined ? UI_TEXT.settings.invalidContextRows : undefined
    };
    setSettingsErrors(nextErrors);
    if (cContextRows === undefined || otherContextRows === undefined) {
      return;
    }

    const nextSettings: AppSettings = {
      ...settings,
      winMergePath: settingsDraft.winMergePath,
      bazaarPath: settingsDraft.bazaarPath,
      rowOutput: {
        cFiles: {
          contextRows: cContextRows,
          hideRetainedRows: settingsDraft.cHideRetainedRows
        },
        otherTextFiles: {
          contextRows: otherContextRows,
          hideRetainedRows: settingsDraft.otherHideRetainedRows
        }
      }
    };

    try {
      await window.diffRepo.saveSettings(nextSettings);
      setSettings(nextSettings);
      closeSettings();
    } catch (error) {
      setSettingsSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  async function run(): Promise<void> {
    const request = jobRequest;
    if (!request) {
      return;
    }

    setRunState("running");
    setProgress(null);
    setLog([UI_TEXT.log.started]);
    try {
      const result = await window.diffRepo.startJob(request);
      if (result.status === "cancelled") {
        setRunState("cancelled");
        setProgress(null);
        setLog((current) => [UI_TEXT.log.cancelled, ...current]);
        return;
      }

      setRunState("completed");
      const { summary } = result;
      setLog((current) => [
        UI_TEXT.log.done(summary.changedFiles, summary.outputChangeListPath),
        UI_TEXT.log.done(summary.comparedFiles, summary.outputPathTestWorkbookPath),
        UI_TEXT.log.done(summary.comparedFiles, summary.outputWorkbookPath),
        ...current
      ]);
    } catch (error) {
      setRunState("failed");
      setLog((current) => [UI_TEXT.log.error(error instanceof Error ? error.message : String(error)), ...current]);
    }
  }

  async function cancelRun(): Promise<void> {
    if (runState !== "running") {
      return;
    }

    setRunState("cancelling");
    setProgress({
      phase: "cancelling",
      message: "中止処理中",
      completed: 0,
      total: 0
    });
    setLog((current) => [UI_TEXT.log.cancelling, ...current]);
    try {
      await window.diffRepo.cancelJob();
    } catch (error) {
      setRunState("failed");
      setLog((current) => [UI_TEXT.log.error(error instanceof Error ? error.message : String(error)), ...current]);
    }
  }

  function appendErrorLog(message: string): void {
    setLog((current) => [UI_TEXT.log.error(message), ...current]);
  }

  return (
    <main className="app-shell">
      <div ref={backgroundRef} className="app-content">
        <header className="topbar">
        <div>
          <h1>{UI_TEXT.appTitle}</h1>
          <p>{UI_TEXT.appDescription}</p>
        </div>
        <div className="topbar-actions">
          <button
            ref={settingsButtonRef}
            type="button"
            className="icon-button toolbar-button"
            onClick={openSettings}
            disabled={!editingEnabled}
            title={UI_TEXT.actions.openSettings}
            aria-label={UI_TEXT.actions.openSettings}
          >
            <Settings size={19} />
          </button>
          <button className="primary-button" disabled={!canRun} onClick={() => void run()} title={UI_TEXT.actions.runReport}>
            <Play size={18} />
            <span>{UI_TEXT.actions.run}</span>
          </button>
          {busy ? (
            <button
              type="button"
              className="secondary-button stop-button"
              disabled={runState === "cancelling"}
              onClick={() => void cancelRun()}
              title={UI_TEXT.actions.stop}
            >
              <Square size={17} fill="currentColor" />
              <span>{UI_TEXT.actions.stop}</span>
            </button>
          ) : null}
        </div>
      </header>

      <section className="layout">
        <div className="main-column">
          <div className="segmented" aria-label="Input mode">
            <button disabled={!editingEnabled} className={mode === "folders" ? "active" : ""} onClick={() => setMode("folders")}>
              <FolderOpen size={17} />
              <span>{UI_TEXT.modes.folders}</span>
            </button>
            <button disabled={!editingEnabled} className={mode === "bazaar" ? "active" : ""} onClick={() => setMode("bazaar")}>
              <GitBranch size={17} />
              <span>{UI_TEXT.modes.bazaar}</span>
            </button>
          </div>

          {mode === "folders" ? (
            <section className="panel two-column">
              <PathDropField disabled={!editingEnabled} label={UI_TEXT.fields.beforeFolder} value={leftFolder} onChange={setLeftFolder} onBrowse={() => void pickDirectory(setLeftFolder)} onDropError={appendErrorLog} />
              <PathDropField disabled={!editingEnabled} label={UI_TEXT.fields.afterFolder} value={rightFolder} onChange={setRightFolder} onBrowse={() => void pickDirectory(setRightFolder)} onDropError={appendErrorLog} />
            </section>
          ) : (
            <section className="panel form-grid">
              <PathDropField disabled={!editingEnabled} label={UI_TEXT.fields.bazaarRepository} value={repoPath} onChange={setRepoPath} onBrowse={() => void pickDirectory(setRepoPath)} onDropError={appendErrorLog} />
              <TextField disabled={!editingEnabled} label={UI_TEXT.fields.beforeRevision} value={leftRevision} onChange={setLeftRevision} placeholder="例: 123" />
              <TextField disabled={!editingEnabled} label={UI_TEXT.fields.afterRevision} value={rightRevision} onChange={setRightRevision} placeholder="例: 124" />
            </section>
          )}

          <section className="panel form-grid">
            <TextField disabled={!editingEnabled} label={UI_TEXT.fields.outputWorkbook} value={outputWorkbookPath} onChange={setOutputWorkbookPath} action={{ icon: <FileSpreadsheet size={17} />, label: UI_TEXT.actions.saveAs, onClick: () => void pickOutput() }} />
            <TextField disabled={!editingEnabled} label={UI_TEXT.fields.outputPathTestWorkbook} value={outputPathTestWorkbookPath} onChange={setOutputPathTestWorkbookPath} action={{ icon: <FileSpreadsheet size={17} />, label: UI_TEXT.actions.choosePathTestWorkbook, onClick: () => void pickPathTestOutput() }} />
            <TextField disabled={!editingEnabled} label={UI_TEXT.fields.outputChangeList} value={outputChangeListPath} onChange={setOutputChangeListPath} action={{ icon: <FileText size={17} />, label: UI_TEXT.actions.saveAs, onClick: () => void pickChangeListOutput() }} />
          </section>
        </div>

        <aside className="side-panel">
          <div className={`status ${runState}`}>
            <strong>{statusLabel(runState)}</strong>
            <span>{progress?.message ?? (runState === "cancelled" ? UI_TEXT.hints.cancelled : UI_TEXT.hints.ready)}</span>
            {progress && progress.total > 0 ? (
              <progress value={progress.completed} max={progress.total} />
            ) : (
              <progress value={busy ? 1 : 0} max={1} />
            )}
          </div>
          <div className="log">
            {log.length === 0 ? <span className="muted">{UI_TEXT.hints.emptyLog}</span> : log.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
        </aside>
      </section>
      </div>

      {settingsDraft ? (
        <SettingsDialog
          draft={settingsDraft}
          errors={settingsErrors}
          saveError={settingsSaveError}
          onChange={updateSettingsDraft}
          onBrowseWinMerge={() => void pickWinMerge()}
          onBrowseBazaar={() => void pickBazaar()}
          onSave={() => void saveSettings()}
          onClose={closeSettings}
        />
      ) : null}
    </main>
  );
}

function createSettingsDraft(settings: AppSettings): SettingsDraft {
  return {
    winMergePath: settings.winMergePath,
    bazaarPath: settings.bazaarPath,
    cContextRows: String(settings.rowOutput.cFiles.contextRows),
    cHideRetainedRows: settings.rowOutput.cFiles.hideRetainedRows,
    otherContextRows: String(settings.rowOutput.otherTextFiles.contextRows),
    otherHideRetainedRows: settings.rowOutput.otherTextFiles.hideRetainedRows
  };
}

interface SettingsDialogProps {
  draft: SettingsDraft;
  errors: SettingsErrors;
  saveError: string | null;
  onChange: (patch: Partial<SettingsDraft>) => void;
  onBrowseWinMerge: () => void;
  onBrowseBazaar: () => void;
  onSave: () => void;
  onClose: () => void;
}

function SettingsDialog({
  draft,
  errors,
  saveError,
  onChange,
  onBrowseWinMerge,
  onBrowseBazaar,
  onSave,
  onClose
}: SettingsDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (dialogRef.current) {
      focusFirstModalControl(dialogRef.current);
    }
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (dialogRef.current) {
            trapModalTab(event, dialogRef.current, document.activeElement);
          }
        }}
      >
        <header className="dialog-header">
          <h2 id="settings-dialog-title">{UI_TEXT.settings.title}</h2>
          <button type="button" className="icon-button dialog-close" onClick={onClose} title={UI_TEXT.actions.close} aria-label={UI_TEXT.actions.close}>
            <X size={19} />
          </button>
        </header>

        <div className="settings-content">
          <RowOutputSettings
            title={UI_TEXT.settings.groups.cFiles}
            contextRows={draft.cContextRows}
            hideRetainedRows={draft.cHideRetainedRows}
            error={errors.cContextRows}
            onContextRowsChange={(value) => onChange({ cContextRows: value })}
            onHideRetainedRowsChange={(value) => onChange({ cHideRetainedRows: value })}
          />
          <RowOutputSettings
            title={UI_TEXT.settings.groups.otherTextFiles}
            contextRows={draft.otherContextRows}
            hideRetainedRows={draft.otherHideRetainedRows}
            error={errors.otherContextRows}
            onContextRowsChange={(value) => onChange({ otherContextRows: value })}
            onHideRetainedRowsChange={(value) => onChange({ otherHideRetainedRows: value })}
          />

          <fieldset className="settings-group">
            <legend>{UI_TEXT.settings.groups.externalTools}</legend>
            <TextField
              label={UI_TEXT.fields.winMergeExecutable}
              value={draft.winMergePath}
              onChange={(value) => onChange({ winMergePath: value })}
              action={{ icon: <FolderOpen size={17} />, label: UI_TEXT.actions.browse, onClick: onBrowseWinMerge }}
            />
            <TextField
              label={UI_TEXT.fields.bazaarExecutable}
              value={draft.bazaarPath}
              onChange={(value) => onChange({ bazaarPath: value })}
              action={{ icon: <FolderOpen size={17} />, label: UI_TEXT.actions.browse, onClick: onBrowseBazaar }}
            />
          </fieldset>

          {saveError ? <div className="settings-save-error" role="alert">{saveError}</div> : null}
        </div>

        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>{UI_TEXT.actions.cancel}</button>
          <button type="button" className="primary-button" onClick={onSave}>{UI_TEXT.actions.save}</button>
        </footer>
      </section>
    </div>
  );
}

interface RowOutputSettingsProps {
  title: string;
  contextRows: string;
  hideRetainedRows: boolean;
  error?: string;
  onContextRowsChange: (value: string) => void;
  onHideRetainedRowsChange: (value: boolean) => void;
}

function RowOutputSettings({
  title,
  contextRows,
  hideRetainedRows,
  error,
  onContextRowsChange,
  onHideRetainedRowsChange
}: RowOutputSettingsProps): JSX.Element {
  return (
    <fieldset className="settings-group">
      <legend>{title}</legend>
      <label className="field settings-number-field">
        <span>{UI_TEXT.settings.contextRows}</span>
        <input
          className={error ? "input-error" : undefined}
          value={contextRows}
          inputMode="numeric"
          onChange={(event) => onContextRowsChange(event.target.value)}
          aria-invalid={error ? "true" : "false"}
        />
        {error ? <span className="field-error">{error}</span> : null}
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={hideRetainedRows}
          onChange={(event) => onHideRetainedRowsChange(event.target.checked)}
        />
        <span>{UI_TEXT.settings.hideRetainedRows}</span>
      </label>
    </fieldset>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  action?: {
    icon: JSX.Element;
    label: string;
    onClick: () => void;
  };
}

function TextField({ label, value, onChange, placeholder, disabled = false, action }: TextFieldProps): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-row">
        <input disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        {action ? (
          <button disabled={disabled} type="button" className="icon-button text-button" onClick={action.onClick} title={action.label}>
            {action.icon}
            <span>{action.label}</span>
          </button>
        ) : null}
      </div>
    </label>
  );
}

interface PathDropFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  onDropError: (message: string) => void;
  disabled?: boolean;
}

function PathDropField({ label, value, onChange, onBrowse, onDropError, disabled = false }: PathDropFieldProps): JSX.Element {
  return (
    <div
      className="drop-field"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (disabled) {
          return;
        }
        void resolveFirstDroppedDirectoryPath(
          event.dataTransfer.files,
          window.diffRepo.getDroppedFilePath,
          window.diffRepo.isDirectory
        ).then((path) => {
          if (path) {
            onChange(path);
          }
        }).catch((error: unknown) => {
          onDropError(error instanceof Error ? error.message : String(error));
        });
      }}
    >
      <label className="field">
        <span>{label}</span>
        <div className="input-row">
          <input disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} />
          <button disabled={disabled} type="button" className="icon-button text-button" onClick={onBrowse} title={UI_TEXT.actions.chooseFolder}>
            <FolderOpen size={17} />
            <span>{UI_TEXT.actions.browse}</span>
          </button>
        </div>
      </label>
      <div className="drop-hint">
        <Upload size={16} />
        <span>{UI_TEXT.hints.dropFolder}</span>
      </div>
    </div>
  );
}
