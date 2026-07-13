import { randomUUID } from "crypto"
import * as path from "path"
import * as vscode from "vscode"
import { createAuthoringModelFromTemplate } from "../core/workflowAuthoringDefaults"
import { WorkflowAuthoringModel, WorkflowAuthoringStep } from "../core/workflowAuthoringModel"
import { serializeAuthoringModelToMarkdown } from "../core/workflowAuthoringSerializer"
import { validateStepDraft } from "../core/workflowAuthoringStepDraftValidation"
import { validateWorkflowDocumentPath } from "../core/workflowDocumentPath"
import { WorkflowTemplateKind, workflowTemplates } from "../core/workflowScaffold"
import { formatWorkflowDiagnostics, validateWorkflowText } from "../core/workflowValidator"
import { renderWorkflowBuilderHtml } from "./workflowBuilderHtml"

export interface WorkflowBuilderPanelOptions {
  extensionUri: vscode.Uri
  workflowRoot: string
  sourceId: string
  mode?: "create" | "edit"
  initialModel?: WorkflowAuthoringModel
  editingFilePath?: string
  originalText?: string
  focusStepId?: string
}

type WorkflowBuilderMessage =
  | { type: "preview"; model: WorkflowAuthoringModel }
  | { type: "save"; model: WorkflowAuthoringModel }
  | { type: "diff"; model: WorkflowAuthoringModel }
  | { type: "validateStepDraft"; model: WorkflowAuthoringModel; draftStep: WorkflowAuthoringStep; stepIndex: number }
  | { type: "resetTemplate"; name: string; title?: string; description: string; template: WorkflowTemplateKind }

type WorkflowBuilderSession = {
  readonly token: symbol
  readonly options: Readonly<WorkflowBuilderPanelOptions>
  originalText?: string
}

type WorkflowBuilderSaveContext = {
  readonly session: WorkflowBuilderSession
  readonly rendered: ReturnType<typeof serializeAuthoringModelToMarkdown>
  readonly targetUri: vscode.Uri
  readonly targetPath: string
}

export class WorkflowBuilderPanel {
  private static currentPanel: WorkflowBuilderPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []
  private readonly saveQueues = new Map<string, Promise<void>>()
  private options: WorkflowBuilderPanelOptions
  private activeSession: WorkflowBuilderSession

  private constructor(options: WorkflowBuilderPanelOptions, initialModel: WorkflowAuthoringModel) {
    this.options = { ...options }
    this.activeSession = createSession(options)
    this.panel = vscode.window.createWebviewPanel("workflowRegisterBuilder", this.panelTitle(), vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true })
    this.panel.webview.html = this.renderHtml(initialModel)
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables)
    this.panel.webview.onDidReceiveMessage((message: WorkflowBuilderMessage) => this.onMessage(message), undefined, this.disposables)
  }

  static createOrShow(options: WorkflowBuilderPanelOptions): WorkflowBuilderPanel {
    const initialModel = options.initialModel ?? createAuthoringModelFromTemplate({ name: "new-workflow", title: "New Workflow", description: "Run New Workflow.", template: "simple-agent" })
    if (WorkflowBuilderPanel.currentPanel) {
      WorkflowBuilderPanel.currentPanel.startSession(options, initialModel)
      return WorkflowBuilderPanel.currentPanel
    }
    const panel = new WorkflowBuilderPanel(options, initialModel)
    WorkflowBuilderPanel.currentPanel = panel
    return panel
  }

  dispose(): void {
    WorkflowBuilderPanel.currentPanel = undefined
    while (this.disposables.length) this.disposables.pop()?.dispose()
  }

  private async onMessage(message: WorkflowBuilderMessage): Promise<void> {
    if (message.type === "resetTemplate") {
      this.postModel(createAuthoringModelFromTemplate(message))
      return
    }
    if (message.type === "preview") return this.preview(message.model)
    if (message.type === "diff") return this.showDiff(message.model)
    if (message.type === "validateStepDraft") return this.validateStepDraft(message.model, message.draftStep, message.stepIndex)
    if (message.type === "save") await this.enqueueSave(message.model)
  }

  private enqueueSave(model: WorkflowAuthoringModel): Promise<void> {
    const session = this.activeSession
    const rendered = serializeAuthoringModelToMarkdown(model)
    const targetUri = this.targetUri(rendered.filePath, session.options)
    const targetPath = this.displayPathForUri(targetUri, rendered.filePath, session.options)
    const context: WorkflowBuilderSaveContext = { session, rendered, targetUri, targetPath }
    const queueKey = normalizedPathKey(targetUri.fsPath)
    const previous = this.saveQueues.get(queueKey) ?? Promise.resolve()
    const save = previous.catch(() => undefined).then(() => this.save(context))
    let tail: Promise<void>
    const clear = (): void => {
      if (this.saveQueues.get(queueKey) === tail) this.saveQueues.delete(queueKey)
    }
    tail = save.then(clear, clear)
    this.saveQueues.set(queueKey, tail)
    return save
  }

  private startSession(options: WorkflowBuilderPanelOptions, initialModel: WorkflowAuthoringModel): void {
    this.options = { ...options }
    this.activeSession = createSession(options)
    this.panel.title = this.panelTitle()
    this.panel.reveal(vscode.ViewColumn.One)
    this.postModel(initialModel)
  }

  private async preview(model: WorkflowAuthoringModel): Promise<void> {
    const rendered = serializeAuthoringModelToMarkdown(model)
    const targetUri = this.targetUri(rendered.filePath)
    const filePath = this.displayPathForUri(targetUri, rendered.filePath)
    const validation = validateWorkflowText({ sourceId: this.options.sourceId, filePath, text: rendered.markdown })
    await this.panel.webview.postMessage({ type: "previewResult", markdown: rendered.markdown, ok: validation.ok, diagnostics: formatWorkflowDiagnostics(validation), filePath })
  }

  private async validateStepDraft(model: WorkflowAuthoringModel, draftStep: WorkflowAuthoringStep, stepIndex: number): Promise<void> {
    const originalStep = model.steps[stepIndex]
    const stepValidation = validateStepDraft({ model, originalStep, draftStep, stepIndex })
    const draftModel: WorkflowAuthoringModel = {
      ...model,
      steps: model.steps.map((step, index) => index === stepIndex ? draftStep : step)
    }
    const rendered = serializeAuthoringModelToMarkdown(draftModel)
    const targetUri = this.targetUri(rendered.filePath)
    const filePath = this.displayPathForUri(targetUri, rendered.filePath)
    const workflowValidation = validateWorkflowText({ sourceId: this.options.sourceId, filePath, text: rendered.markdown })
    await this.panel.webview.postMessage({
      type: "stepDraftValidationResult",
      stepIndex,
      stepValidation,
      workflowValidation: {
        ok: workflowValidation.ok,
        diagnostics: formatWorkflowDiagnostics(workflowValidation),
        filePath,
        markdown: rendered.markdown
      }
    })
  }

  private async showDiff(model: WorkflowAuthoringModel): Promise<void> {
    const rendered = serializeAuthoringModelToMarkdown(model)
    const targetUri = this.targetUri(rendered.filePath)
    if (this.options.mode !== "edit" || !(await exists(targetUri))) {
      await vscode.window.showInformationMessage("Diff preview is available after opening an existing WORKFLOW.md in edit mode.")
      return
    }
    const previewDir = vscode.Uri.joinPath(vscode.Uri.file(this.options.workflowRoot), ".bob", "workflows", ".previews")
    await vscode.workspace.fs.createDirectory(previewDir)
    const previewUri = vscode.Uri.joinPath(previewDir, `workflow-builder-${timestamp()}.md`)
    await vscode.workspace.fs.writeFile(previewUri, new TextEncoder().encode(rendered.markdown))
    await vscode.commands.executeCommand("vscode.diff", targetUri, previewUri, `Workflow Builder Preview: ${this.displayPathForUri(targetUri, rendered.filePath)}`)
  }

  private async save(context: WorkflowBuilderSaveContext): Promise<void> {
    const { rendered, session, targetPath, targetUri } = context
    const options = session.options
    if (!this.isActiveSession(session)) return
    const savePathValidation = validateWorkflowDocumentPath({ workspaceRoot: options.workflowRoot, filePath: targetUri.fsPath })
    if (!savePathValidation.ok) {
      await vscode.window.showErrorMessage(`GUI Builder can only save .bob/workflows/*/WORKFLOW.md inside the workflow workspace: ${savePathValidation.reason}`)
      return
    }
    const validation = validateWorkflowText({ sourceId: options.sourceId, filePath: targetPath, text: rendered.markdown })
    if (!validation.ok) {
      await this.panel.webview.postMessage({ type: "previewResult", markdown: rendered.markdown, ok: false, diagnostics: formatWorkflowDiagnostics(validation), filePath: targetPath })
      if (!this.isActiveSession(session)) return
      await vscode.window.showErrorMessage("Workflow validation failed. Fix errors before saving.")
      return
    }
    if (options.mode === "edit" && targetPath !== rendered.filePath) {
      const proceed = await vscode.window.showWarningMessage(`The workflow name points to '${rendered.filePath}', but edit mode will update '${targetPath}'. Continue?`, { modal: true }, "Continue")
      if (!this.isActiveSession(session)) return
      if (proceed !== "Continue") return
    }
    const dir = vscode.Uri.file(path.dirname(targetUri.fsPath))
    await vscode.workspace.fs.createDirectory(dir)
    if (!this.isActiveSession(session)) return
    const targetExists = await exists(targetUri)
    if (!this.isActiveSession(session)) return
    let backupUri: vscode.Uri | undefined
    if (targetExists) {
      const label = options.mode === "edit" ? "Apply changes" : "Overwrite"
      const overwrite = await vscode.window.showWarningMessage(`${targetPath} already exists. ${label} after creating a backup?`, { modal: true }, label)
      if (!this.isActiveSession(session)) return
      if (overwrite !== label) return
      const existingBytes = await vscode.workspace.fs.readFile(targetUri)
      if (!this.isActiveSession(session)) return
      if (options.mode === "edit" && session.originalText !== undefined) {
        const currentText = new TextDecoder().decode(existingBytes)
        if (currentText !== session.originalText) {
          await vscode.window.showWarningMessage(`${targetPath} was changed outside this Builder. Reopen or refresh the workflow before saving again.`)
          return
        }
      }
      backupUri = await createExclusiveBackup(dir, existingBytes)
      if (!this.isActiveSession(session)) {
        await deleteFileIfPresent(backupUri)
        return
      }
      let revalidatedBytes: Uint8Array
      try {
        revalidatedBytes = await vscode.workspace.fs.readFile(targetUri)
      } catch {
        if (!this.isActiveSession(session)) {
          await deleteFileIfPresent(backupUri)
          return
        }
        await vscode.window.showWarningMessage(`${targetPath} was changed outside this Builder while its backup was being created. Reopen or refresh the workflow before saving again.`)
        return
      }
      if (!this.isActiveSession(session)) {
        await deleteFileIfPresent(backupUri)
        return
      }
      if (!sameBytes(existingBytes, revalidatedBytes)) {
        await vscode.window.showWarningMessage(`${targetPath} was changed outside this Builder while its backup was being created. Reopen or refresh the workflow before saving again.`)
        return
      }
    } else if (options.mode === "edit") {
      const create = await vscode.window.showWarningMessage(`${targetPath} no longer exists. Create it?`, { modal: true }, "Create")
      if (!this.isActiveSession(session)) return
      if (create !== "Create") return
      const targetAppeared = await exists(targetUri)
      if (!this.isActiveSession(session)) return
      if (targetAppeared) {
        try {
          await vscode.workspace.fs.readFile(targetUri)
        } catch {
          // Any mutation after the confirming stat is still a conflict; the operator must retry from fresh state.
        }
        if (!this.isActiveSession(session)) return
        await vscode.window.showWarningMessage(`${targetPath} was created outside this Builder while the Create confirmation was open. Reopen or refresh the workflow before saving again.`)
        return
      }
      // workspace.fs has no create-if-absent write. Keep this check adjacent to writeFile,
      // leaving only the filesystem provider's final stat-to-write syscall interval.
    }
    if (!this.isActiveSession(session)) {
      if (backupUri) await deleteFileIfPresent(backupUri)
      return
    }
    await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(rendered.markdown))
    session.originalText = rendered.markdown
    await vscode.commands.executeCommand("workflowRegister.reload")
    if (!this.isActiveSession(session)) return
    this.options.originalText = session.originalText
    const document = await vscode.workspace.openTextDocument(targetUri)
    if (!this.isActiveSession(session)) return
    await vscode.window.showTextDocument(document, { preview: false })
    if (!this.isActiveSession(session)) return
    await this.panel.webview.postMessage({ type: "saved", filePath: targetPath })
    if (!this.isActiveSession(session)) return
    await vscode.window.showInformationMessage(`Saved ${targetPath}`)
  }

  private isActiveSession(session: WorkflowBuilderSession): boolean {
    return this.activeSession.token === session.token
  }

  private postModel(model: WorkflowAuthoringModel): void {
    void this.panel.webview.postMessage({ type: "model", model, editMode: this.options.mode === "edit", filePath: this.options.editingFilePath ?? "", focusStepId: this.options.focusStepId ?? "" })
  }

  private panelTitle(): string {
    return this.options.mode === "edit" ? "Bob Workflow Builder: Edit" : "Bob Workflow Builder"
  }

  private targetUri(renderedFilePath: string, options: Readonly<WorkflowBuilderPanelOptions> = this.options): vscode.Uri {
    if (options.mode === "edit" && options.editingFilePath) return vscode.Uri.file(options.editingFilePath)
    return vscode.Uri.joinPath(vscode.Uri.file(options.workflowRoot), ...renderedFilePath.split("/"))
  }

  private displayPathForUri(uri: vscode.Uri, fallback: string, options: Readonly<WorkflowBuilderPanelOptions> = this.options): string {
    const relative = path.relative(options.workflowRoot, uri.fsPath).replace(/\\/g, "/")
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : fallback
  }

  private renderHtml(initialModel: WorkflowAuthoringModel): string {
    const isEditMode = this.options.mode === "edit"
    return renderWorkflowBuilderHtml({
      cspSource: this.panel.webview.cspSource,
      initialModel,
      isEditMode,
      focusStepId: this.options.focusStepId,
      modeNote: isEditMode
        ? "既存の <code>WORKFLOW.md</code> を読み込んで編集します。保存時は backup を作成してから上書きします。"
        : "フォームで新しい <code>.bob/workflows/&lt;name&gt;/WORKFLOW.md</code> を作成します。参照関係は編集中に検出し、保存前にも既存 validator で確認します。",
      nonce: getNonce(),
      templateOptions: workflowTemplates.map((template) => ({ id: template.id, label: template.label, description: template.description }))
    })
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
  }
}

function createSession(options: WorkflowBuilderPanelOptions): WorkflowBuilderSession {
  const snapshot = Object.freeze({ ...options })
  return { token: Symbol("workflowBuilderSession"), options: snapshot, originalText: snapshot.originalText }
}

async function createExclusiveBackup(dir: vscode.Uri, existingBytes: Uint8Array): Promise<vscode.Uri> {
  const uniqueId = randomUUID()
  const backupUri = vscode.Uri.joinPath(dir, `WORKFLOW.backup-${timestamp()}-${uniqueId}.md`)
  const stagingUri = vscode.Uri.joinPath(dir, `.workflow-builder-backup-${uniqueId}.tmp`)
  await vscode.workspace.fs.writeFile(stagingUri, existingBytes)
  try {
    await vscode.workspace.fs.copy(stagingUri, backupUri, { overwrite: false })
  } finally {
    await vscode.workspace.fs.delete(stagingUri, { useTrash: false })
  }
  return backupUri
}

async function deleteFileIfPresent(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri, { useTrash: false })
  } catch {
    // A stale session must never resume its target commit even if provider cleanup fails.
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function normalizedPathKey(filePath: string): string {
  const normalized = path.normalize(filePath)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let text = ""
  for (let index = 0; index < 32; index += 1) text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}
