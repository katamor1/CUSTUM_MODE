import * as path from "path"
import * as vscode from "vscode"
import { createAuthoringModelFromTemplate } from "../core/workflowAuthoringDefaults"
import { WorkflowAuthoringModel, WorkflowAuthoringStep } from "../core/workflowAuthoringModel"
import { serializeAuthoringModelToMarkdown } from "../core/workflowAuthoringSerializer"
import { validateStepDraft } from "../core/workflowAuthoringStepDraftValidation"
import { isWorkflowDocumentPath } from "../core/workflowDocumentPath"
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

export class WorkflowBuilderPanel {
  private static currentPanel: WorkflowBuilderPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []

  private constructor(private options: WorkflowBuilderPanelOptions, initialModel: WorkflowAuthoringModel) {
    this.panel = vscode.window.createWebviewPanel("workflowRegisterBuilder", this.panelTitle(), vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true })
    this.panel.webview.html = this.renderHtml(initialModel)
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables)
    this.panel.webview.onDidReceiveMessage((message: WorkflowBuilderMessage) => this.onMessage(message), undefined, this.disposables)
  }

  static createOrShow(options: WorkflowBuilderPanelOptions): WorkflowBuilderPanel {
    const initialModel = options.initialModel ?? createAuthoringModelFromTemplate({ name: "new-workflow", title: "New Workflow", description: "Run New Workflow.", template: "simple-agent" })
    if (WorkflowBuilderPanel.currentPanel) {
      WorkflowBuilderPanel.currentPanel.options = options
      WorkflowBuilderPanel.currentPanel.panel.title = WorkflowBuilderPanel.currentPanel.panelTitle()
      WorkflowBuilderPanel.currentPanel.panel.reveal(vscode.ViewColumn.One)
      WorkflowBuilderPanel.currentPanel.postModel(initialModel)
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
    if (message.type === "save") await this.save(message.model)
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

  private async save(model: WorkflowAuthoringModel): Promise<void> {
    const rendered = serializeAuthoringModelToMarkdown(model)
    const targetUri = this.targetUri(rendered.filePath)
    const targetPath = this.displayPathForUri(targetUri, rendered.filePath)
    if (this.options.mode === "edit" && !isWorkflowDocumentPath(targetUri.fsPath)) {
      await vscode.window.showErrorMessage("GUI Builder edit mode can only overwrite .bob/workflows/*/WORKFLOW.md files.")
      return
    }
    const validation = validateWorkflowText({ sourceId: this.options.sourceId, filePath: targetPath, text: rendered.markdown })
    if (!validation.ok) {
      await this.panel.webview.postMessage({ type: "previewResult", markdown: rendered.markdown, ok: false, diagnostics: formatWorkflowDiagnostics(validation), filePath: targetPath })
      await vscode.window.showErrorMessage("Workflow validation failed. Fix errors before saving.")
      return
    }
    if (this.options.mode === "edit" && targetPath !== rendered.filePath) {
      const proceed = await vscode.window.showWarningMessage(`The workflow name points to '${rendered.filePath}', but edit mode will update '${targetPath}'. Continue?`, { modal: true }, "Continue")
      if (proceed !== "Continue") return
    }
    const dir = vscode.Uri.file(path.dirname(targetUri.fsPath))
    await vscode.workspace.fs.createDirectory(dir)
    if (await exists(targetUri)) {
      const label = this.options.mode === "edit" ? "Apply changes" : "Overwrite"
      const overwrite = await vscode.window.showWarningMessage(`${targetPath} already exists. ${label} after creating a backup?`, { modal: true }, label)
      if (overwrite !== label) return
      await vscode.workspace.fs.copy(targetUri, vscode.Uri.joinPath(dir, `WORKFLOW.backup-${timestamp()}.md`), { overwrite: true })
    } else if (this.options.mode === "edit") {
      const create = await vscode.window.showWarningMessage(`${targetPath} no longer exists. Create it?`, { modal: true }, "Create")
      if (create !== "Create") return
    }
    await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(rendered.markdown))
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(targetUri), { preview: false })
    await vscode.commands.executeCommand("workflowRegister.reload")
    await this.panel.webview.postMessage({ type: "saved", filePath: targetPath })
    await vscode.window.showInformationMessage(`Saved ${targetPath}`)
  }

  private postModel(model: WorkflowAuthoringModel): void {
    void this.panel.webview.postMessage({ type: "model", model, editMode: this.options.mode === "edit", filePath: this.options.editingFilePath ?? "", focusStepId: this.options.focusStepId ?? "" })
  }

  private panelTitle(): string {
    return this.options.mode === "edit" ? "Bob Workflow Builder: Edit" : "Bob Workflow Builder"
  }

  private targetUri(renderedFilePath: string): vscode.Uri {
    if (this.options.mode === "edit" && this.options.editingFilePath) return vscode.Uri.file(this.options.editingFilePath)
    return vscode.Uri.joinPath(vscode.Uri.file(this.options.workflowRoot), ...renderedFilePath.split("/"))
  }

  private displayPathForUri(uri: vscode.Uri, fallback: string): string {
    const relative = path.relative(this.options.workflowRoot, uri.fsPath).replace(/\\/g, "/")
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
