import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface TemplateRefreshResult {
  refreshed: boolean
  backupPath?: string
  skippedReason?: "cancelled"
}

export interface TemplateRefreshPreview {
  sourcePath: string
  targetPath: string
  diffPreview: string
}

export interface TemplateRefreshOptions {
  confirmOverwrite?: (preview: TemplateRefreshPreview) => Promise<boolean> | boolean
}

const MAX_DIFF_PREVIEW_CHARS = 12000
const MAX_DIFF_PREVIEW_CHANGED_LINES = 160

export async function refreshTemplateFile(source: string, target: string, options: TemplateRefreshOptions = {}): Promise<TemplateRefreshResult> {
  const sourceContent = await fs.readFile(source)
  await fs.mkdir(path.dirname(target), { recursive: true })

  if (await exists(target)) {
    const targetContent = await fs.readFile(target)
    if (sourceContent.equals(targetContent)) {
      return { refreshed: false }
    }
    if (options.confirmOverwrite) {
      const approved = await Promise.resolve(options.confirmOverwrite({
        sourcePath: source,
        targetPath: target,
        diffPreview: buildDiffPreview(target, source, targetContent.toString("utf8"), sourceContent.toString("utf8"))
      }))
      if (!approved) {
        return { refreshed: false, skippedReason: "cancelled" }
      }
    }
    const backupPath = await nextBackupPath(target)
    await fs.copyFile(target, backupPath)
    await fs.writeFile(target, sourceContent)
    return { refreshed: true, backupPath }
  }

  await fs.writeFile(target, sourceContent)
  return { refreshed: true }
}

function buildDiffPreview(targetPath: string, sourcePath: string, currentText: string, templateText: string): string {
  const currentLines = currentText.split(/\r?\n/)
  const templateLines = templateText.split(/\r?\n/)
  const lines = [
    `--- ${targetPath}`,
    `+++ ${sourcePath}`
  ]
  let previewChars = lines.join("\n").length
  let changedLines = 0
  const maxLines = Math.max(currentLines.length, templateLines.length)

  for (let index = 0; index < maxLines; index += 1) {
    const currentLine = currentLines[index]
    const templateLine = templateLines[index]
    if (currentLine === templateLine) continue

    if (currentLine !== undefined) {
      const line = `-${currentLine}`
      lines.push(line)
      previewChars += line.length + 1
      changedLines += 1
    }
    if (templateLine !== undefined) {
      const line = `+${templateLine}`
      lines.push(line)
      previewChars += line.length + 1
      changedLines += 1
    }
    if (changedLines >= MAX_DIFF_PREVIEW_CHANGED_LINES || previewChars >= MAX_DIFF_PREVIEW_CHARS) {
      lines.push("... diff preview truncated ...")
      break
    }
  }

  if (changedLines === 0) {
    lines.push("(content differs only by line endings or non-text bytes)")
  }

  const preview = lines.join("\n")
  return preview.length <= MAX_DIFF_PREVIEW_CHARS
    ? preview
    : `${preview.slice(0, MAX_DIFF_PREVIEW_CHARS - 32)}\n... diff preview truncated ...`
}

async function nextBackupPath(filePath: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`
    const candidate = `${filePath}.bak-${stamp}-${randomUUID()}${suffix}`
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`Unable to allocate backup path for ${filePath}`)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
