import * as vscode from "vscode"
import {
  checkReadinessFromStudioModel,
  createDefaultStudioModel,
  generateWorkflowFromStudioModel,
  listTemplateLibrary,
  previewWorkflowFromStudioModel,
  validateCustomizationFromStudioModel,
  validateProfileFromStudioModel,
  type TemplateCustomizationStudioModel,
  type TemplateLibraryEntry,
  writeWorkflowDiffPreviewFromStudioModel
} from "../template/templateStudioModel"
import { renderTemplateCustomizationStudioHtml } from "./templateCustomizationStudioHtml"

export interface TemplateCustomizationStudioPanelOptions {
  extensionUri: vscode.Uri
  workspaceRoot: string
}

type TemplateCustomizationStudioMessage =
  | { type: "listTemplates" }
  | { type: "loadTemplate"; templatePath?: string }
  | { type: "validateProfile"; model?: TemplateCustomizationStudioModel }
  | { type: "validateCustomization"; model?: TemplateCustomizationStudioModel }
  | { type: "previewWorkflow"; model?: TemplateCustomizationStudioModel }
  | { type: "generateWorkflow"; model?: TemplateCustomizationStudioModel }
  | { type: "checkReadiness"; model?: TemplateCustomizationStudioModel }
  | { type: "openReadinessReport" }
  | { type: "showWorkflowDiff"; model?: TemplateCustomizationStudioModel }
  | { type: string; model?: TemplateCustomizationStudioModel; [key: string]: unknown }

export class TemplateCustomizationStudioPanel {
  private static currentPanel: TemplateCustomizationStudioPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private disposables: vscode.Disposable[] = []
  private templates: TemplateLibraryEntry[]
  private model: TemplateCustomizationStudioModel
  private lastReadinessMarkdownPath: string | undefined

  private constructor(private options: TemplateCustomizationStudioPanelOptions, templates: TemplateLibraryEntry[], model: TemplateCustomizationStudioModel, diagnostics: string[]) {
    this.templates = templates
    this.model = model
    this.panel = vscode.window.createWebviewPanel(
      "bobTemplateCustomizationStudio",
      "Bob Workflow: テンプレートカスタマイズ Studio",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    this.panel.webview.html = this.renderHtml(diagnostics)
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables)
    this.panel.webview.onDidReceiveMessage((message: TemplateCustomizationStudioMessage) => this.onMessage(message), undefined, this.disposables)
  }

  static async createOrShow(options: TemplateCustomizationStudioPanelOptions): Promise<TemplateCustomizationStudioPanel | undefined> {
    const library = await listTemplateLibrary(options.workspaceRoot)
    if (library.templates.length === 0) {
      await vscode.window.showErrorMessage(`Template library is empty. ${library.diagnostics.join("; ")}`)
      return undefined
    }
    const model = createDefaultStudioModel(library.templates[0])
    if (TemplateCustomizationStudioPanel.currentPanel) {
      TemplateCustomizationStudioPanel.currentPanel.options = options
      TemplateCustomizationStudioPanel.currentPanel.templates = library.templates
      TemplateCustomizationStudioPanel.currentPanel.model = model
      TemplateCustomizationStudioPanel.currentPanel.panel.reveal(vscode.ViewColumn.One)
      TemplateCustomizationStudioPanel.currentPanel.panel.webview.html = TemplateCustomizationStudioPanel.currentPanel.renderHtml(library.diagnostics)
      return TemplateCustomizationStudioPanel.currentPanel
    }
    const panel = new TemplateCustomizationStudioPanel(options, library.templates, model, library.diagnostics)
    TemplateCustomizationStudioPanel.currentPanel = panel
    return panel
  }

  dispose(): void {
    TemplateCustomizationStudioPanel.currentPanel = undefined
    while (this.disposables.length) this.disposables.pop()?.dispose()
  }

  private async onMessage(message: TemplateCustomizationStudioMessage): Promise<void> {
    if (message.type === "listTemplates") {
      const library = await listTemplateLibrary(this.options.workspaceRoot)
      this.templates = library.templates
      await this.panel.webview.postMessage({ type: "templateList", templates: this.templates, diagnostics: library.diagnostics })
      return
    }
    if (message.type === "loadTemplate") {
      const template = this.templates.find((candidate) => candidate.templatePath === message.templatePath) ?? this.templates[0]
      this.model = createDefaultStudioModel(template)
      this.panel.webview.html = this.renderHtml([])
      return
    }
    if (message.type === "validateProfile") {
      await this.validateProfile(modelFromMessage(message, this.model))
      return
    }
    if (message.type === "validateCustomization") {
      await this.validateCustomization(modelFromMessage(message, this.model))
      return
    }
    if (message.type === "previewWorkflow") {
      await this.preview(modelFromMessage(message, this.model))
      return
    }
    if (message.type === "generateWorkflow") {
      await this.generate(modelFromMessage(message, this.model))
      return
    }
    if (message.type === "checkReadiness") {
      await this.checkReadiness(modelFromMessage(message, this.model))
      return
    }
    if (message.type === "openReadinessReport") {
      await this.openReadinessReport()
      return
    }
    if (message.type === "showWorkflowDiff") {
      await this.showDiff(modelFromMessage(message, this.model))
    }
  }

  private async validateProfile(model: TemplateCustomizationStudioModel): Promise<void> {
    this.model = model
    const result = validateProfileFromStudioModel(model)
    await this.panel.webview.postMessage({ type: "diagnostics", scope: "profile", result })
  }

  private async validateCustomization(model: TemplateCustomizationStudioModel): Promise<void> {
    this.model = model
    const result = validateCustomizationFromStudioModel(model)
    await this.panel.webview.postMessage({ type: "diagnostics", scope: "customization", result })
  }

  private async preview(model: TemplateCustomizationStudioModel): Promise<void> {
    this.model = model
    const result = await previewWorkflowFromStudioModel(this.options.workspaceRoot, model)
    await this.panel.webview.postMessage({
      type: "previewResult",
      status: result.status,
      markdown: result.workflowMarkdown ?? "",
      diagnostics: result.diagnostics,
      filePath: result.relativePath ?? ""
    })
  }

  private async generate(model: TemplateCustomizationStudioModel): Promise<void> {
    this.model = model
    const result = await generateWorkflowFromStudioModel(this.options.workspaceRoot, model)
    if (result.status !== "ok") {
      await this.panel.webview.postMessage({ type: "previewResult", status: result.status, markdown: result.workflowMarkdown ?? "", diagnostics: result.diagnostics, filePath: result.relativePath ?? "" })
      await vscode.window.showErrorMessage(`Workflow generation failed: ${result.diagnostics.join("; ")}`)
      return
    }
    const workflowUri = workspaceUri(this.options.workspaceRoot, result.workflowPath)
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(workflowUri), { preview: false })
    await vscode.commands.executeCommand("workflowRegister.reload")
    await this.panel.webview.postMessage({
      type: "generated",
      status: "ok",
      workflowPath: result.workflowPath,
      projectProfilePath: result.projectProfilePath,
      customizationPath: result.customizationPath,
      backupPath: result.backupPath,
      diagnostics: result.diagnostics
    })
    await vscode.window.showInformationMessage(`Generated ${result.workflowPath}`)
  }

  private async showDiff(model: TemplateCustomizationStudioModel): Promise<void> {
    this.model = model
    const result = await writeWorkflowDiffPreviewFromStudioModel(this.options.workspaceRoot, model)
    if (result.status !== "ok") {
      await this.panel.webview.postMessage({ type: "previewResult", status: result.status, markdown: result.workflowMarkdown ?? "", diagnostics: result.diagnostics, filePath: result.targetPath ?? "" })
      await vscode.window.showErrorMessage(`Workflow preview failed: ${result.diagnostics.join("; ")}`)
      return
    }
    const targetUri = workspaceUri(this.options.workspaceRoot, result.targetPath)
    const previewUri = workspaceUri(this.options.workspaceRoot, result.previewPath)
    if (!(await exists(targetUri))) {
      await vscode.window.showInformationMessage("既存 WORKFLOW.md がないため diff は開かず、preview ファイルだけを作成しました。")
      await this.panel.webview.postMessage({ type: "previewResult", status: "ok", markdown: result.workflowMarkdown, diagnostics: result.diagnostics, filePath: result.previewPath })
      return
    }
    await vscode.commands.executeCommand("vscode.diff", targetUri, previewUri, `Template Studio Preview: ${result.targetPath}`)
    await this.panel.webview.postMessage({ type: "previewResult", status: "ok", markdown: result.workflowMarkdown, diagnostics: result.diagnostics, filePath: result.previewPath })
  }

  private async checkReadiness(model: TemplateCustomizationStudioModel): Promise<void> {
    this.model = model
    const result = await checkReadinessFromStudioModel(this.options.workspaceRoot, model)
    if (result.status === "ok") {
      this.lastReadinessMarkdownPath = result.readinessMarkdownPath
    }
    await this.panel.webview.postMessage({
      type: "readinessResult",
      status: result.status,
      diagnostics: result.diagnostics,
      readiness: result.readiness,
      readinessJsonPath: result.readinessJsonPath,
      readinessMarkdownPath: result.readinessMarkdownPath
    })
  }

  private async openReadinessReport(): Promise<void> {
    if (!this.lastReadinessMarkdownPath) {
      await vscode.window.showInformationMessage("Readiness report is not available yet. Run readiness check first.")
      return
    }
    const reportUri = workspaceUri(this.options.workspaceRoot, this.lastReadinessMarkdownPath)
    if (!(await exists(reportUri))) {
      await vscode.window.showErrorMessage(`Readiness report is missing: ${this.lastReadinessMarkdownPath}`)
      return
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(reportUri), { preview: false })
  }

  private renderHtml(diagnostics: string[]): string {
    return renderTemplateCustomizationStudioHtml({
      cspSource: this.panel.webview.cspSource,
      nonce: getNonce(),
      templates: this.templates,
      model: this.model,
      diagnostics
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

function modelFromMessage(
  message: { model?: TemplateCustomizationStudioModel },
  fallback: TemplateCustomizationStudioModel
): TemplateCustomizationStudioModel {
  return message.model ?? fallback
}

function workspaceUri(workspaceRoot: string, relativePath: string): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), ...relativePath.split("/"))
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let text = ""
  for (let index = 0; index < 32; index += 1) text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}
