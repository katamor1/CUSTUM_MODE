import * as vscode from "vscode"
import { BazaarClient } from "./bazaar"
import { isBobCodeExtensionAvailable } from "../bob/bobCodeExtension"
import { addMarkdownPacketToBobContext } from "../bob/bobContext"
import { resolveBzrPath } from "./bzrPathTrust"
import { loadProjectChecklistRequired, loadReviewResultSchemaRequired } from "../projectRules/io"
import { buildProjectRulesSection } from "../projectRules/packet"
import { buildReviewPacket } from "./reviewPacket"
import { clampMaxAddedFileContentBytes, clampMaxDiffBytes, maxBufferForDiffBytes } from "./reviewLimits"
import { buildAddedFilesContentSection, loadBazaarRevisionPacketInput } from "./revisionInfo"
import { isWorkflowRegisterExtensionAvailable } from "../workflow/workflowRegisterBridge"
import { resolveBazaarWorkspaceFolder, resolveBobWorkspaceFolder } from "../workspace/workspaceResolver"

export async function reviewRevision(context: vscode.ExtensionContext, withProjectRules: boolean): Promise<void> {
  const bazaarFolder = await pickBazaarWorkspaceFolder()
  if (!bazaarFolder) return
  const bobFolder = withProjectRules ? await pickBobWorkspaceFolder(undefined, true) : undefined
  if (withProjectRules && !bobFolder) return

  const revision = await vscode.window.showInputBox({
    title: withProjectRules ? "プロジェクト規約付きで Bazaar 1リビジョンをレビュー" : "Bob で Bazaar 1リビジョンをレビュー",
    prompt: "レビュー対象の Bazaar リビジョンを入力してください。例: 1234 または revid:...",
    validateInput: (value) => value.trim() ? undefined : "リビジョンは必須です。"
  })
  if (!revision) return

  await withProgress("Bazaar 1リビジョンレビュー packet を作成しています", async () => {
    const client = makeBazaarClient()
    const input = await loadBazaarRevisionPacketInput(client, bazaarFolder.uri.fsPath, revision)
    const [addedFilesSection, projectRulesSection] = await Promise.all([
      buildAddedFilesContentSection(client, input.root, revision, input.info, getMaxAddedFileContentBytes()),
      withProjectRules && bobFolder ? buildProjectRulesSectionForWorkspace(bobFolder.uri.fsPath) : Promise.resolve(undefined)
    ])

    const extraSections = [addedFilesSection, projectRulesSection].filter((section): section is string => Boolean(section))
    const packet = buildReviewPacket({
      repositoryRoot: input.root,
      mode: "singleRevision",
      revision,
      log: input.log,
      diff: input.diff,
      maxDiffBytes: getMaxDiffBytes(),
      extraSections: extraSections.length > 0 ? extraSections : undefined
    })

    await showAndOfferBobContext(context, packet, withProjectRules ? `bazaar-project-review-${revision}.md` : `bazaar-review-${revision}.md`)
  })
}

export async function reviewRange(context: vscode.ExtensionContext, withProjectRules: boolean): Promise<void> {
  const bazaarFolder = await pickBazaarWorkspaceFolder()
  if (!bazaarFolder) return
  const bobFolder = withProjectRules ? await pickBobWorkspaceFolder(undefined, true) : undefined
  if (withProjectRules && !bobFolder) return

  const baseRevision = await vscode.window.showInputBox({
    title: withProjectRules ? "プロジェクト規約付きで Bazaar リビジョン範囲をレビュー" : "Bob で Bazaar リビジョン範囲をレビュー",
    prompt: "基準となる Bazaar リビジョンを入力してください。例: 1200",
    validateInput: (value) => value.trim() ? undefined : "基準リビジョンは必須です。"
  })
  if (!baseRevision) return

  const targetRevision = await vscode.window.showInputBox({
    title: withProjectRules ? "プロジェクト規約付きで Bazaar リビジョン範囲をレビュー" : "Bob で Bazaar リビジョン範囲をレビュー",
    prompt: "比較先の Bazaar リビジョンを入力してください。例: 1234",
    validateInput: (value) => value.trim() ? undefined : "比較先リビジョンは必須です。"
  })
  if (!targetRevision) return

  await withProgress("Bazaar リビジョン範囲レビュー packet を作成しています", async () => {
    const client = makeBazaarClient()
    const root = await client.root(bazaarFolder.uri.fsPath)
    const [diff, projectRulesSection] = await Promise.all([
      client.diffRange(root, baseRevision, targetRevision),
      withProjectRules && bobFolder ? buildProjectRulesSectionForWorkspace(bobFolder.uri.fsPath) : Promise.resolve(undefined)
    ])

    const packet = buildReviewPacket({
      repositoryRoot: root,
      mode: "revisionRange",
      baseRevision,
      targetRevision,
      diff,
      maxDiffBytes: getMaxDiffBytes(),
      extraSections: projectRulesSection ? [projectRulesSection] : undefined
    })

    const outputFileName = withProjectRules
      ? `bazaar-project-review-${baseRevision}-${targetRevision}.md`
      : `bazaar-review-${baseRevision}-${targetRevision}.md`
    await showAndOfferBobContext(context, packet, outputFileName)
  })
}

async function buildProjectRulesSectionForWorkspace(workspaceRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  const checklistPath = config.get<string>("projectRules.checklistPath", ".bob/review/checklist.json")
  const schemaPath = config.get<string>("projectRules.schemaPath", ".bob/review/review-result.schema.json")
  const [checklist, schema] = await Promise.all([
    loadProjectChecklistRequired(workspaceRoot, checklistPath),
    loadReviewResultSchemaRequired(workspaceRoot, schemaPath)
  ])
  return buildProjectRulesSection({ checklist, schema })
}

function makeBazaarClient(): BazaarClient {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return new BazaarClient({
    bzrPath: resolveBzrPath(config, vscode.workspace.isTrusted),
    maxBuffer: maxBufferForDiffBytes(getMaxDiffBytes()),
    textEncoding: config.get<string>("textEncoding", "auto")
  })
}

function getMaxDiffBytes(): number {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return clampMaxDiffBytes(config.get<number>("maxDiffBytes", 1024 * 1024))
}

function getMaxAddedFileContentBytes(): number {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return clampMaxAddedFileContentBytes(config.get<number>("maxAddedFileContentBytes", 256 * 1024))
}

async function pickBazaarWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveBazaarWorkspaceFolder({ allowPick: true, title: "Bazaar ワークスペースを選択" })
}

async function pickBobWorkspaceFolder(workflowRoot?: string, allowPick = true): Promise<vscode.WorkspaceFolder | undefined> {
  return resolveBobWorkspaceFolder({ workflowRoot, allowPick, title: "Bob ワークスペースを選択" })
}

async function showAndOfferBobContext(context: vscode.ExtensionContext, packet: string, filename: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: packet
  })
  const editor = await vscode.window.showTextDocument(document, { preview: false })

  if (!isBobCodeExtensionAvailable()) {
    await vscode.window.showInformationMessage("IBM Bob 拡張機能が見つからないため、Bazaar Revision Review Request の Markdown を作成しました。Bob チャットへの挿入は行いません。")
    return
  }

  if (!isWorkflowRegisterExtensionAvailable()) {
    const result = await addPacketToBobContext(editor.document.uri, packet)
    if (result === "added") {
      await vscode.window.showInformationMessage("workflow-register 未導入のため、Bazaar Revision Review Request を Bob チャットへ挿入しました。")
    }
    return
  }

  const action = await vscode.window.showInformationMessage(
    "Bazaar レビュー packet を作成しました。Bob コンテキストへ追加しますか？",
    "Bob コンテキストへ追加",
    "クリップボードへコピー",
    "ファイルに保存"
  )

  if (action === "Bob コンテキストへ追加") {
    await addPacketToBobContext(editor.document.uri, packet)
  } else if (action === "クリップボードへコピー") {
    await vscode.env.clipboard.writeText(packet)
  } else if (action === "ファイルに保存") {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(context.globalStorageUri, filename),
      filters: { Markdown: ["md"] }
    })
    if (target) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."))
      await vscode.workspace.fs.writeFile(target, Buffer.from(packet, "utf8"))
    }
  }
}

async function addPacketToBobContext(uri: vscode.Uri, packet: string) {
  return addMarkdownPacketToBobContext({
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    writeClipboard: (text) => vscode.env.clipboard.writeText(text),
    showWarningMessage: (message) => vscode.window.showWarningMessage(message)
  }, uri, packet)
}

async function withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task)
}
