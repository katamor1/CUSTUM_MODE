const assert = require("node:assert/strict")
const { test } = require("node:test")

const {
  MAX_CODE_EVIDENCE_ITEMS,
  createCodeEvidenceBudget,
  reserveCodeEvidence
} = require("../out/analyzers/codeEvidenceBudget")

test("code evidence budget enforces per-item and aggregate UTF-8 limits", () => {
  const warnings = []
  const budget = createCodeEvidenceBudget({
    maxExcerptBytesPerDocument: 80,
    maxBobInputBytes: 220
  })

  const first = reserveCodeEvidence({
    label: "src/one.ts",
    text: "変更内容".repeat(80),
    render: (text) => `# one\n\n${text}\n`
  }, budget, warnings)
  const second = reserveCodeEvidence({
    label: "src/two.ts",
    text: "second ".repeat(80),
    render: (text) => `# two\n\n${text}\n`
  }, budget, warnings)

  assert.ok(first)
  assert.ok(Buffer.byteLength(first.text, "utf8") <= 80)
  const total = [first, second].filter(Boolean).reduce((bytes, item) => bytes + Buffer.byteLength(item.markdown, "utf8"), 0)
  assert.ok(total <= 220)
  assert.ok(warnings.some((warning) => warning.includes("maxExcerptBytesPerDocument")))
})

test("code evidence budget stops after the aggregate budget is exhausted", () => {
  const warnings = []
  const budget = createCodeEvidenceBudget({
    maxExcerptBytesPerDocument: 1024,
    maxBobInputBytes: 90
  })

  const first = reserveCodeEvidence({
    label: "src/one.ts",
    text: "x".repeat(1000),
    render: (text) => `# one\n${text}`
  }, budget, warnings)
  const second = reserveCodeEvidence({
    label: "src/two.ts",
    text: "next",
    render: (text) => `# two\n${text}`
  }, budget, warnings)

  assert.ok(first)
  assert.equal(second, undefined)
  assert.equal(budget.exhausted, true)
  assert.ok(warnings.some((warning) => warning.includes("aggregate maxBobInputBytes")))
})

test("code evidence budget caps retained evidence item count", () => {
  const warnings = []
  const budget = createCodeEvidenceBudget({
    maxExcerptBytesPerDocument: 32,
    maxBobInputBytes: 8 * 1024 * 1024
  })
  budget.remainingItems = 1

  assert.ok(reserveCodeEvidence({ label: "one", text: "one", render: (text) => text }, budget, warnings))
  assert.equal(reserveCodeEvidence({ label: "two", text: "two", render: (text) => text }, budget, warnings), undefined)
  assert.equal(MAX_CODE_EVIDENCE_ITEMS, 500)
  assert.ok(warnings.some((warning) => warning.includes("maximum item count")))
})
