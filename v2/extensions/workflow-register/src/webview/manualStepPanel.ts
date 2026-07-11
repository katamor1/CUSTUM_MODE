import { renderManualStepHtml } from "./manualStepPanelHtml"
import {
  buildManualStepActionViewModel,
  type ManualStepActionViewModel,
  type ManualStepPanelInput
} from "./manualStepViewModel"

interface DisposableLike {
  dispose(): unknown
}

export interface ManualStepPanelHost {
  createWebviewPanel: (
    viewType: string,
    title: string,
    showOptions: unknown,
    options: { enableScripts: boolean }
  ) => ManualStepWebviewPanel
  showWarningMessage: (message: string, options: { modal: boolean }, ...items: string[]) => Promise<string | undefined>
  showInformationMessage: (message: string) => Promise<unknown>
  activeViewColumn: unknown
}

export interface ManualStepWebviewPanel {
  webview: {
    cspSource: string
    html: string
    onDidReceiveMessage: (listener: (message: unknown) => unknown) => DisposableLike
  }
  reveal: () => unknown
  onDidDispose: (listener: () => unknown) => DisposableLike
  dispose: () => unknown
}

export interface ManualStepCompletionRequest {
  activeKey: string
  expectedRunId: string
  expectedStepId: string
}

export interface ManualStepCompletionResult {
  ok: boolean
  message: string
}

interface ManualStepPanelControllerOptions {
  host: ManualStepPanelHost
  completeStep: (request: ManualStepCompletionRequest) => Promise<ManualStepCompletionResult>
}

export class ManualStepPanelController implements DisposableLike {
  private panel?: ManualStepWebviewPanel
  private current?: ManualStepPanelInput
  private messageSubscription?: DisposableLike
  private panelSubscription?: DisposableLike
  private disposed = false

  constructor(private readonly options: ManualStepPanelControllerOptions) {}

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const panel = this.panel
    this.panel = undefined
    this.current = undefined
    this.messageSubscription?.dispose()
    this.messageSubscription = undefined
    this.panelSubscription?.dispose()
    this.panelSubscription = undefined
    panel?.dispose()
  }

  async show(input: ManualStepPanelInput): Promise<void> {
    if (this.disposed) throw new Error("Manual step panel controller is disposed.")
    this.current = input
    const panel = this.ensurePanel()
    panel.webview.html = this.render(input)
    panel.reveal()
  }

  private ensurePanel(): ManualStepWebviewPanel {
    if (this.disposed) throw new Error("Manual step panel controller is disposed.")
    if (this.panel) return this.panel
    const panel = this.options.host.createWebviewPanel(
      "workflowRegister.manualStepPanel",
      "Bob Workflow Manual Step",
      this.options.host.activeViewColumn,
      { enableScripts: true }
    )
    this.messageSubscription = panel.webview.onDidReceiveMessage((message) => this.handleMessage(message))
    this.panelSubscription = panel.onDidDispose(() => {
      this.messageSubscription?.dispose()
      this.messageSubscription = undefined
      this.panelSubscription = undefined
      this.panel = undefined
      this.current = undefined
    })
    this.panel = panel
    return panel
  }

  private render(input: ManualStepPanelInput, override?: Partial<ManualStepActionViewModel>): string {
    const panel = this.ensurePanel()
    const viewModel = {
      ...buildManualStepActionViewModel(input),
      ...override
    }
    return renderManualStepHtml({
      cspSource: panel.webview.cspSource,
      nonce: createNonce(),
      viewModel
    })
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isCompleteManualStepMessage(message)) return
    if (!this.current || !this.panel) return

    const currentViewModel = buildManualStepActionViewModel(this.current)
    if (!currentViewModel.activeKey || currentViewModel.status !== "active") {
      this.panel.webview.html = this.render(this.current, {
        activeKey: undefined,
        status: "error",
        message: "現在完了できる active step がありません。Run Control View で状態を確認してください。"
      })
      return
    }
    if (message.activeKey !== currentViewModel.activeKey) {
      this.panel.webview.html = this.render(this.current, {
        activeKey: undefined,
        status: "error",
        message: `Active Bob workflow step mismatch: expected activeKey=${currentViewModel.activeKey}; received activeKey=${message.activeKey}.`
      })
      return
    }
    if (currentViewModel.confirmOnComplete) {
      const accepted = await this.options.host.showWarningMessage(
        currentViewModel.confirmMessage || "この step を完了済みとして workflow を進めます。よろしいですか？",
        { modal: true },
        "完了"
      )
      if (accepted !== "完了") {
        this.panel.webview.html = this.render(this.current)
        return
      }
    }

    const activeKey = currentViewModel.activeKey
    const expectedRunId = currentViewModel.runId
    const expectedStepId = currentViewModel.stepId
    const result = await this.options.completeStep({ activeKey, expectedRunId, expectedStepId })
    await this.options.host.showInformationMessage(result.message)
    if (this.current && this.panel) {
      if (result.ok) this.current = { ...this.current, active: undefined }
      this.panel.webview.html = this.render(this.current, {
        activeKey: undefined,
        status: result.ok ? "completed" : "error",
        message: result.ok
          ? `この step は完了しました。\n\n${result.message}`
          : result.message
      })
    }
  }
}

function isCompleteManualStepMessage(value: unknown): value is { type: "completeManualStep"; activeKey: string } {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return record.type === "completeManualStep" && typeof record.activeKey === "string" && record.activeKey.length > 0
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let index = 0; index < 24; index += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}
