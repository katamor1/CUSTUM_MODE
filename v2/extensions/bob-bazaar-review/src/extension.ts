import * as vscode from "vscode"
import { BazaarClient } from "./bazaar"
import { configureWorkspaceMcpServer } from "./mcpConfig"
import { buildReviewPacket } from "./reviewPacket"
import { initializeProjectRules, loadProjectChecklist, loadReviewResultSchema } from "./projectRules/io"
import { buildProjectRulesSection } from "./projectRules/packet"
import { validateReviewResultJson } from "./projectRules/validator"
import { renderReviewResultMarkdown } from "./projectRules/markdown"
import { ReviewResult } from "./projectRules/types"

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("bobBazaar.configureMcp", () => configureMcp(context)),
    vscode.commands.registerCommand("bobBazaar.initProjectRules", () => initProjectRules()),
    vscode.commands.registerCommand("bobBazaar.reviewRevision", () => reviewRevision(context, false)),
    vscode.commands.registerCommand("bobBazaar.reviewRange", () => reviewRange(context, false)),
    vscode.commands.registerCommand("bobBazaar.reviewRevisionWithProjectRules", () => reviewRevision(context, true)),
    vscode.commands.registerCommand("bobBazaar.reviewRangeWithProjectRules", () => reviewRange(context, true)),
    vscode.commands.registerCommand("bobBazaar.validateReviewResultJson", () => validateActiveReviewResultJson())
  )
}

export function deactivate(): void {
  // No background process is kept by the extension host. Bob starts the MCP server on demand.
}

async function configureMcp(context: vscode.ExtensionContext): Promise<void> {
  const folder = await pickWorkspaceFolder()
  if (!folder) return

  const config = vscode.workspace.getConfiguration("bobBazaar")
  const bzrPath = config.get<string>("bzrPath", "bzr")
  const serverName = config.get<string>("mcpServerName", "bazaar")

  const result = await configureWorkspaceMcpServer({
    workspaceFolder: folder,
    extensionContext: context,
    serverName,
    bzrPath
  })

  await vscode.window.showInformationMessage(
    `Configured Bob MCP server '${result.serverName}' in ${result.configPath}. Restart or refresh Bob MCP servers if it is already running.`
  )
}

async function initProjectRules(): Promise<void> {
  const folder = await pickWorkspaceFolder()
  if (!folder) return

  const paths = await initializeProjectRules(folder.uri.fsPath)
  await vscode.window.showInformationMessage(`Initialized project review rules in ${paths.reviewDir}`)

  const checklistDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(paths.checklistPath))
  await vscode.window.showTextDocument(checklistDoc, { preview: false })
}

async function reviewRevision(context: vscode.ExtensionContext, withProjectRules: boolean): Promise<void> {
  const folder = await pickWorkspaceFolder()
  if (!folder) return

  const revision = await vscode.window.showInputBox({
    title: withProjectRules ? "Review Bazaar Revision with Project Rules" : "Review Bazaar Revision with Bob",
    prompt: "Bazaar revision to review, for example 1234 or revid:...",
    validateInput: (value) => value.trim() ? undefined : "Revision is required"
  })
  if (!revision) return

  await withProgress("Preparing Bazaar revision review packet", async () => {
    const client = makeBazaarClient()
    const root = await client.root(folder.uri.fsPath)
    const [log, diff, projectRulesSection] = await Promise.all([
      client.log(root, revision),
      client.diffRevision(root, revision),
      withProjectRules ? buildProjectRulesSectionForWorkspace(root) : Promise.resolve(undefined)
    ])

    const packet = buildReviewPacket({
      repositoryRoot: root,
      mode: "singleRevision",
      revision,
      log,
      diff,
      maxDiffBytes: getMaxDiffBytes(),
      extraSections: projectRulesSection ? [projectRulesSection] : undefined
    })

    await showAndOfferBobContext(context, packet, withProjectRules ? `bazaar-project-review-${revision}.md` : `bazaar-review-${revision}.md`)
  })
}

async function reviewRange(context: vscode.ExtensionContext, withProjectRules: boolean): Promise<void> {
  const folder = await pickWorkspaceFolder()
  if (!folder) return

  const baseRevision = await vscode.window.showInputBox({
    title: withProjectRules ? "Review Bazaar Revision Range with Project Rules" : "Review Bazaar Revision Range with Bob",
    prompt: "Base Bazaar revision, for example 1200",
    validateInput: (value) => value.trim() ? undefined : "Base revision is required"
  })
  if (!baseRevision) return

  const targetRevision = await vscode.window.showInputBox({
    title: withProjectRules ? "Review Bazaar Revision Range with Project Rules" : "Review Bazaar Revision Range with Bob",
    prompt: "Target Bazaar revision, for example 1234",
    validateInput: (value) => value.trim() ? undefined : "Target revision is required"
  })
  if (!targetRevision) return

  await withProgress("Preparing Bazaar revision range review packet", async () => {
    const client = makeBazaarClient()
    const root = await client.root(folder.uri.fsPath)
    const [diff, projectRulesSection] = await Promise.all([
      client.diffRange(root, baseRevision, targetRevision),
      withProjectRules ? buildProjectRulesSectionForWorkspace(root) : Promise.resolve(undefined)
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

    await showAndOfferBobContext(context, packet, withProjectRules ? `bazaar-project-review-${baseRevision}-${targetRevision}.md` : `bazaar-review-${baseRevision}-${targetRevision}.md`)
  })
}

async function buildProjectRulesSectionForWorkspace(workspaceRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  const checklistPath = config.get<string>("projectRules.checklistPath", ".bob/review/checklist.json")
  const schemaPath = config.get<string>("projectRules.schemaPath", ".bob/review/review-result.schema.json")
  const [checklist, schema] = await Promise.all([
    loadProjectChecklist(workspaceRoot, checklistPath),
    loadReviewResultSchema(workspaceRoot, schemaPath)
  ])
  return buildProjectRulesSection({ checklist, schema })
}

async function validateActiveReviewResultJson(): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    await vscode.window.showWarningMessage("Open a review result JSON document first.")
    return
  }

  const raw = editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection)
  const validation = validateReviewResultJson(raw)
  if (!validation.valid) {
    const report = [
      "# Review Result JSON Validation Failed",
      "",
      ...validation.issues.map((issue) => `- ${issue.path}: ${issue.message}`)
    ].join("\n")
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: report })
    await vscode.window.showTextDocument(doc, { preview: false })
    return
  }

  const action = await vscode.window.showInformationMessage("Review result JSON is valid.", "Render Markdown Summary")
  if (action === "Render Markdown Summary") {
    const result = JSON.parse(raw) as ReviewResult
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: renderReviewResultMarkdown(result) })
    await vscode.window.showTextDocument(doc, { preview: false })
  }
}

function makeBazaarClient(): BazaarClient {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return new BazaarClient({
    bzrPath: config.get<string>("bzrPath", "bzr"),
    maxBuffer: Math.max(getMaxDiffBytes() * 2, 2 * 1024 * 1024)
  })
}

function getMaxDiffBytes(): number {
  const config = vscode.workspace.getConfiguration("bobBazaar")
  return config.get<number>("maxDiffBytes", 1024 * 1024)
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) {
    await vscode.window.showWarningMessage("Open a Bazaar workspace folder first.")
    return undefined
  }
  if (folders.length === 1) {
    return folders[0]
  }

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: "Select Bazaar workspace" }
  )
  return picked?.folder
}

async function showAndOfferBobContext(context: vscode.ExtensionContext, packet: string, filename: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: packet
  })
  const editor = await vscode.window.showTextDocument(document, { preview: false })

  const action = await vscode.window.showInformationMessage(
    "Bazaar review packet is ready. Add it to Bob context?",
    "Add to Bob Context",
    "Copy to Clipboard",
    "Save File"
  )

  if (action === "Add to Bob Context") {
    await addToBobContext(editor.document.uri, packet)
  } else if (action === "Copy to Clipboard") {
    await vscode.env.clipboard.writeText(packet)
  } else if (action === "Save File") {
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

async function addToBobContext(uri: vscode.Uri, packet: string): Promise<void> {
  try {
    const lineCount = packet.split(/\r?\n/).length
    await vscode.commands.executeCommand("bob-code.addToContext", uri, packet, 1, lineCount)
  } catch (error: any) {
    await vscode.env.clipboard.writeText(packet)
    await vscode.window.showWarningMessage(
      `Could not call Bob add-to-context command. The review packet was copied to the clipboard instead. ${error?.message ?? ""}`
    )
  }
}

async function withProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task)
}
