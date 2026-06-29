const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const extensionRoot = path.resolve(__dirname, "..")

test("Bazaar workflow template declares v1 schema and uses revision-derived review ids", () => {
  const workflowPath = path.join(
    extensionRoot,
    "templates",
    ".bob",
    "workflows",
    "bazaar-project-rule-review",
    "WORKFLOW.md"
  )
  const workflow = fs.readFileSync(workflowPath, "utf8")

  assert.match(workflow, /^schemaVersion: workflow-register\/v1$/m)
  assert.match(workflow, /^steps:$/m)
  assert.match(workflow, /title: Bazaar プロジェクト規約レビュー/)
  assert.match(workflow, /description: Bazaar のリビジョンまたはリビジョン範囲を、プロジェクト固有ルールに照らしてレビューします。/)
  assert.match(workflow, /title: レビュー対象/)
  assert.match(workflow, /title: 対象の Bazaar リビジョンまたはリビジョン範囲を確認/)
  assert.match(workflow, /title: Bazaar 差分と変更ファイルのコンテキストを収集/)
  assert.match(workflow, /title: プロジェクトチェックリストとレビュー結果スキーマを読み込み/)
  assert.match(workflow, /title: 変更内容をプロジェクト固有ルールに照らして分析/)
  assert.match(workflow, /title: review-result JSON と Markdown チェックリストを作成/)
  assert.match(workflow, /"review_id": "bazaar-r<revision>-project-rule-review"/)
  assert.match(workflow, /`<revision>` を実際の Bazaar リビジョンまたはリビジョン範囲へ置き換えてください。/)
  assert.match(workflow, /`checklist_results\[\]\.severity` は必ず `error`、`warning`、`info` のいずれかにしてください。/)
  assert.match(workflow, /読み込んだ checklist rule ごとに、必ず1つの `checklist_results` entry を含めてください。/)
  assert.match(workflow, /checklist rule 数と一致している必要があります。/)
  assert.doesNotMatch(workflow, /bazaar-r2-project-rule-review/)
  assert.doesNotMatch(workflow, /```workflow-step/)
  assert.doesNotMatch(workflow, /^## Step:/m)
})
