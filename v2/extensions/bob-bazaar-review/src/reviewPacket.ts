import { BazaarCommandResult } from "./bazaar"

export interface ReviewPacketOptions {
  repositoryRoot: string
  mode: "singleRevision" | "revisionRange" | "workingTreeSinceRevision"
  revision?: string
  baseRevision?: string
  targetRevision?: string
  log?: BazaarCommandResult
  diff: BazaarCommandResult
  maxDiffBytes: number
  extraSections?: string[]
}

export function buildReviewPacket(options: ReviewPacketOptions): string {
  const revisionLabel = buildRevisionLabel(options)
  const diffText = truncateUtf8(options.diff.stdout, options.maxDiffBytes)
  const logText = options.log ? truncateUtf8(options.log.stdout, 128 * 1024) : ""

  return [
    "# Bazaar Revision Review Request",
    "",
    `VCS: Bazaar`,
    `Repository root: ${options.repositoryRoot}`,
    `Review mode: ${options.mode}`,
    `Revision target: ${revisionLabel}`,
    "",
    "## Bazaar commands used",
    "",
    "```text",
    `${options.diff.command} ${options.diff.args.join(" ")}`,
    options.log ? `${options.log.command} ${options.log.args.join(" ")}` : "",
    "```",
    "",
    "## Review instruction for Bob",
    "",
    "このBazaarリビジョンまたはリビジョン範囲で導入された変更をレビューしてください。",
    "",
    "重点観点:",
    "- 不具合混入リスク",
    "- C/C++の境界条件、NULL、範囲外、初期化漏れ",
    "- グローバル変数、外部I/F構造体、共有メモリ、PLC/モーション/センサIFへの影響",
    "- 既存仕様、基本設計、詳細設計、単体テスト仕様との不整合",
    "- エラー処理、ログ、リトライ、タイムアウト、排他制御",
    "- テスト不足、デグレードしやすい条件",
    "",
    "出力形式:",
    "- Finding単位で出力",
    "- severity: error / warning / info",
    "- file path と line range",
    "- evidence",
    "- suggested fix または追加確認項目",
    "",
    ...(options.extraSections ?? []).flatMap((section) => [section, ""]),
    logText ? "## Bazaar log" : "",
    logText ? "" : "",
    logText ? "```text" : "",
    logText,
    logText ? "```" : "",
    logText ? "" : "",
    "## Bazaar diff",
    "",
    "```diff",
    diffText,
    "```"
  ].filter((line) => line !== undefined).join("\n")
}

function buildRevisionLabel(options: ReviewPacketOptions): string {
  if (options.mode === "singleRevision") {
    return options.revision ?? "unknown"
  }
  if (options.mode === "revisionRange") {
    return `${options.baseRevision ?? "?"}..${options.targetRevision ?? "?"}`
  }
  return `working tree since ${options.baseRevision ?? "current basis"}`
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8")
  if (bytes <= maxBytes) {
    return value
  }

  let result = value
  while (Buffer.byteLength(result, "utf8") > maxBytes) {
    result = result.slice(0, Math.floor(result.length * 0.9))
  }

  return `${result}\n\n[TRUNCATED: original output was ${bytes} bytes, limit is ${maxBytes} bytes]`
}
