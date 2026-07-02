import * as vscode from "vscode"
import type { ReviewInputDocumentCandidate } from "./core/reviewInputDiscovery"
import {
  ARTIFACT_KIND_VALUES,
  CHANGE_TYPE_VALUES,
  REVIEW_FOCUS_VALUES,
  VCS_VALUES,
  type ArtifactKind,
  type ChangeType,
  type ReviewFocus,
  type ReviewInputArtifactDraft,
  type ReviewInputDraft,
  type VcsKind
} from "./core/reviewInputBuilder"
import {
  changeTypeOption,
  pickValue,
  splitCsv,
  stringArrayOption,
  stringOption,
  stringOrPrompt,
  vcsOrPrompt
} from "./extensionCommandOptions"

type CandidateQuickPickItem = vscode.QuickPickItem & { candidate: ReviewInputDocumentCandidate }

export async function collectReviewMetadata(record: Record<string, unknown>): Promise<ReviewInputDraft["review"] | undefined> {
  const id = stringOption(record, "reviewId") ?? await stringOrPrompt(record, "id", "review.id", "code-consistency-review")
  if (!id) return undefined
  const title = stringOption(record, "title") ?? await stringOrPrompt(record, "reviewTitle", "review.title", "コード整合プレレビュー")
  if (!title) return undefined
  const purpose = stringOption(record, "purpose") ?? await stringOrPrompt(record, "reviewPurpose", "review.purpose", "要求・設計・テスト仕様とコード変更の整合性を確認する")
  if (!purpose) return undefined

  const changeType = changeTypeOption(record) ?? await pickValue(CHANGE_TYPE_VALUES, "変更種別を選択")
  if (!changeType) return undefined
  const vcs = await vcsOrPrompt(record)
  if (!vcs) return undefined
  const base = await stringOrPrompt(record, "base", "review.base", "HEAD~1")
  if (!base) return undefined
  const head = await stringOrPrompt(record, "head", "review.head", "HEAD")
  if (!head) return undefined

  return {
    id,
    title,
    purpose,
    change_type: changeType,
    vcs,
    base,
    head,
    vcs_root: stringOption(record, "vcsRoot") ?? stringOption(record, "vcs_root"),
    ticket_ids: stringArrayOption(record, "ticketIds") ?? stringArrayOption(record, "ticket_ids"),
    out_of_scope: stringArrayOption(record, "outOfScope") ?? stringArrayOption(record, "out_of_scope")
  }
}

export async function collectReviewInputDraft(candidates: ReviewInputDocumentCandidate[]): Promise<ReviewInputDraft | undefined> {
  const id = await vscode.window.showInputBox({ prompt: "review.id", placeHolder: "timeout-bugfix-r1", value: "code-consistency-review" })
  if (id === undefined) return undefined
  const title = await vscode.window.showInputBox({ prompt: "review.title", placeHolder: "タイムアウト処理修正の整合プレレビュー", value: "コード整合プレレビュー" })
  if (title === undefined) return undefined
  const purpose = await vscode.window.showInputBox({ prompt: "review.purpose", placeHolder: "変更目的を短く入力", value: "要求・設計・テスト仕様とコード変更の整合性を確認する" })
  if (purpose === undefined) return undefined

  const changeType = await pickValue(CHANGE_TYPE_VALUES, "変更種別を選択")
  if (!changeType) return undefined
  const vcs = await pickValue(VCS_VALUES, "VCS を選択")
  if (!vcs) return undefined
  const base = await vscode.window.showInputBox({ prompt: "review.base", value: "HEAD~1" })
  if (base === undefined) return undefined
  const head = await vscode.window.showInputBox({ prompt: "review.head", value: "HEAD" })
  if (head === undefined) return undefined

  const focusItems = REVIEW_FOCUS_VALUES.map((focus) => ({ label: focus }))
  const pickedFocus = await vscode.window.showQuickPick(focusItems, { canPickMany: true, placeHolder: "レビュー観点を選択" })
  if (!pickedFocus || pickedFocus.length === 0) return undefined

  const artifacts = await pickArtifacts(candidates)
  if (!artifacts || artifacts.length === 0) return undefined

  const ticketRaw = await vscode.window.showInputBox({ prompt: "ticket_ids（任意、カンマ区切り）", placeHolder: "BUG-1234,TICKET-5678" })
  if (ticketRaw === undefined) return undefined
  const outOfScopeRaw = await vscode.window.showInputBox({ prompt: "out_of_scope（任意、カンマ区切り）", placeHolder: "性能測定, UI 文言レビュー" })
  if (outOfScopeRaw === undefined) return undefined

  return {
    review: {
      id,
      title,
      purpose,
      change_type: changeType as ChangeType,
      vcs: vcs as VcsKind,
      base,
      head,
      ticket_ids: splitCsv(ticketRaw),
      out_of_scope: splitCsv(outOfScopeRaw)
    },
    artifact_candidates: artifacts,
    review_focus: pickedFocus.map((item) => item.label as ReviewFocus)
  }
}

async function pickArtifacts(candidates: ReviewInputDocumentCandidate[]): Promise<ReviewInputArtifactDraft[] | undefined> {
  if (candidates.length > 0) {
    const items: CandidateQuickPickItem[] = candidates.map((candidate) => ({
      label: candidate.label,
      description: candidate.description,
      detail: `${candidate.kind}: ${candidate.path}`,
      candidate
    }))
    const picked = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: "関連文書候補を選択" })
    if (!picked || picked.length === 0) return undefined
    return picked.map((item) => stripCandidateUiFields(item.candidate))
  }

  const artifactPath = await vscode.window.showInputBox({ prompt: "関連文書パスを入力", placeHolder: "docs/requirements.md" })
  if (artifactPath === undefined) return undefined
  const kind = await pickValue(ARTIFACT_KIND_VALUES, "文書種別を選択")
  if (!kind) return undefined
  return [{ kind: kind as ArtifactKind, path: artifactPath }]
}

function stripCandidateUiFields(candidate: ReviewInputDocumentCandidate): ReviewInputArtifactDraft {
  const { label: _label, description: _description, ...artifact } = candidate
  return artifact
}
