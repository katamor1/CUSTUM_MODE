const assert = require("node:assert/strict")
const { test } = require("node:test")

const {
  assertContributesCommand,
  readJson,
  readSrc
} = require("./helpers/sourceReader")

test("package and extension expose Bazaar result capture and human triage GUI commands", () => {
  const packageJson = readJson("package.json")
  const source = readSrc("extension.ts")

  for (const command of [
    "bobBazaar.openResultCaptureGui",
    "bobBazaar.openHumanTriageGui"
  ]) {
    assertContributesCommand(packageJson, command)
    assert.match(source, new RegExp(`registerCommand\\("${command.replace(/\./g, "\\.")}"`))
  }
})

test("Bazaar review GUI renders the v2 wizard handoff steps", () => {
  const { renderHtml } = require("../out/ui/reviewGuiHtml")
  const html = renderHtml("vscode-resource:")

  assert.match(html, /Wizard v2/)
  assert.match(html, /campaign/)
  assert.match(html, /result capture/)
  assert.match(html, /human triage/)
  assert.match(html, /id="openResultCapture"/)
  assert.match(html, /id="openHumanTriage"/)
})

test("Bazaar result capture GUI validates through data-action buttons", () => {
  const { renderResultCaptureHtml } = require("../out/ui/resultCaptureGuiHtml")
  const html = renderResultCaptureHtml({ cspSource: "vscode-resource:", nonce: "nonce-123" })

  assert.match(html, /Result Capture/)
  assert.match(html, /Bob 出力/)
  assert.match(html, /data-action="captureCandidates"/)
  assert.match(html, /data-action="captureManual"/)
  assert.match(html, /data-action="validateActive"/)
  assert.match(html, /data-action="openTriage"/)
  assert.match(html, /nonce-123/)
  assert.match(html, /vscode\.postMessage/)
  assert.doesNotMatch(html, /onclick=/)
})

test("Bazaar human triage GUI renders a decision table and record actions", () => {
  const { renderHumanTriageHtml } = require("../out/ui/humanTriageGuiHtml")
  const html = renderHumanTriageHtml({
    cspSource: "vscode-resource:",
    nonce: "nonce-456",
    model: {
      campaignId: "phase1",
      reviewId: "review-1",
      reviewResultJsonPath: ".bob/review/results/review-1.json",
      triagePath: ".bob-review-records/campaigns/phase1/records/review-1/triage.yaml",
      issues: [],
      items: [
        {
          finding_id: "F-1",
          rule_id: "RULE-1",
          decision: "needs_investigation",
          action: "investigate",
          reason: "確認が必要"
        }
      ]
    }
  })

  assert.match(html, /Human Triage/)
  assert.match(html, /data-action="createTriage"/)
  assert.match(html, /data-action="saveDecisions"/)
  assert.match(html, /data-action="generateSummary"/)
  assert.match(html, /F-1/)
  assert.match(html, /needs_investigation/)
  assert.match(html, /nonce-456/)
  assert.doesNotMatch(html, /onclick=/)
})
