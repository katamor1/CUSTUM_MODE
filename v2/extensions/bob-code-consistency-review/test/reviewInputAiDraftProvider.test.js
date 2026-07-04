const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  applyAiReviewInputDraft,
  parseAiReviewInputDraft,
  prepareAiReviewInputDraftPrompt
} = require("../out/core/reviewInputAiDraftProvider")

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-input-ai-"))
  await fs.mkdir(path.join(root, "docs"), { recursive: true })
  await fs.writeFile(path.join(root, "docs", "requirements.md"), "# Requirements\n\n## REQ-TIMEOUT-001\n\nTimeout behavior requirement.\n", "utf8")
  await fs.writeFile(path.join(root, "docs", "basic-design.md"), "# Basic Design\n\n## BD-TIMEOUT-001\n\nTimeout design.\n", "utf8")
  await fs.writeFile(path.join(root, "diff.json"), JSON.stringify({
    vcs: "git",
    base: "HEAD~1",
    head: "HEAD",
    files: [
      { path: "src/timeout.c", status: "modified", additions: 4, deletions: 2, language: "c" },
      { path: "include/timeout.h", status: "modified", additions: 1, deletions: 1, language: "h", is_interface_candidate: true }
    ],
    unifiedDiff: "diff --git a/src/timeout.c b/src/timeout.c\n+return TIMEOUT;\n",
    warnings: []
  }, null, 2), "utf8")
  return root
}

test("parseAiReviewInputDraft extracts fenced JSON only", () => {
  const draft = parseAiReviewInputDraft(`Ignore this preface.\n\n\`\`\`json\n{\n  "review": { "id": "r1" },\n  "artifact_candidates": []\n}\n\`\`\``)
  assert.equal(draft.review.id, "r1")
  assert.deepEqual(draft.artifact_candidates, [])
})

test("parseAiReviewInputDraft rejects ambiguous or oversized JSON candidates", () => {
  const first = JSON.stringify({ review: { id: "first" }, artifact_candidates: [] })
  const second = JSON.stringify({ review: { id: "second" }, artifact_candidates: [] })
  assert.throws(() => parseAiReviewInputDraft(`\`\`\`json\n${first}\n\`\`\`\n\`\`\`json\n${second}\n\`\`\``), /multiple JSON candidates/)
  assert.throws(() => parseAiReviewInputDraft(`${"x".repeat(1100 * 1024)}\n${first}`), /exceeds maximum/)
})

test("applyAiReviewInputDraft rejects invalid artifact paths before writing", async () => {
  const workspaceRoot = await makeWorkspace()
  const outputPath = path.join(workspaceRoot, "review-input.yaml")
  const result = await applyAiReviewInputDraft({
    workspaceRoot,
    reviewInputPath: outputPath,
    text: JSON.stringify({
      review: {
        id: "missing-doc",
        title: "missing doc",
        change_type: "bugfix",
        purpose: "verify path guard",
        base: "HEAD~1",
        head: "HEAD",
        vcs: "git"
      },
      artifact_candidates: [
        { kind: "requirements", path: "docs/missing.md", sections: ["REQ-MISSING-001"] }
      ],
      review_focus: ["requirement-code-consistency"]
    })
  })

  assert.equal(result.status, "error")
  assert.match(result.errors.join("\n"), /artifact path does not exist: docs\/missing\.md/)
  await assert.rejects(fs.readFile(outputPath, "utf8"), /ENOENT/)
})

test("applyAiReviewInputDraft rejects artifact paths outside the workspace before writing", async () => {
  const workspaceRoot = await makeWorkspace()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-input-outside-"))
  const outsidePath = path.join(outsideRoot, "requirements.md")
  await fs.writeFile(outsidePath, "# Outside\n\n## REQ-OUTSIDE-001\n\nMust not be captured.\n", "utf8")
  const outputPath = path.join(workspaceRoot, "review-input.yaml")
  const result = await applyAiReviewInputDraft({
    workspaceRoot,
    reviewInputPath: outputPath,
    text: JSON.stringify({
      review: {
        id: "outside-doc",
        title: "outside doc",
        change_type: "bugfix",
        purpose: "verify workspace guard",
        base: "HEAD~1",
        head: "HEAD",
        vcs: "git"
      },
      artifact_candidates: [
        { kind: "requirements", path: outsidePath, sections: ["REQ-OUTSIDE-001"] }
      ],
      review_focus: ["requirement-code-consistency"]
    })
  })

  assert.equal(result.status, "error")
  assert.match(result.errors.join("\n"), /artifact path escapes workspace:/)
  await assert.rejects(fs.readFile(outputPath, "utf8"), /ENOENT/)
})

test("applyAiReviewInputDraft writes schema-valid YAML through the builder", async () => {
  const workspaceRoot = await makeWorkspace()
  const outputPath = path.join(workspaceRoot, "review-input.yaml")
  const result = await applyAiReviewInputDraft({
    workspaceRoot,
    reviewInputPath: outputPath,
    text: JSON.stringify({
      review: {
        id: "timeout-review",
        title: "Timeout review",
        change_type: "bugfix",
        purpose: "timeout behavior consistency",
        base: "HEAD~1",
        head: "HEAD",
        vcs: "git",
        ticket_ids: ["TICKET-100"]
      },
      artifact_candidates: [
        { kind: "requirements", path: "docs/requirements.md", sections: ["REQ-TIMEOUT-001"] },
        { kind: "basic_design", path: "docs/basic-design.md", sections: ["BD-TIMEOUT-001"] }
      ],
      review_focus: ["requirement-code-consistency", "design-code-consistency"]
    })
  })

  assert.equal(result.status, "ok")
  const yaml = await fs.readFile(outputPath, "utf8")
  assert.match(yaml, /id: timeout-review/)
  assert.match(yaml, /path: docs\/requirements\.md/)
  assert.match(yaml, /requirement-code-consistency/)
})

test("prepareAiReviewInputDraftPrompt writes constrained prompt with candidates and diff", async () => {
  const workspaceRoot = await makeWorkspace()
  const result = await prepareAiReviewInputDraftPrompt({
    workspaceRoot,
    outputDir: path.join(workspaceRoot, ".bob-review", "review-input-draft"),
    reviewInputPath: path.join(workspaceRoot, "review-input.yaml"),
    base: "HEAD~1",
    head: "HEAD",
    vcs: "git",
    diffFixturePath: path.join(workspaceRoot, "diff.json"),
    textEncoding: "utf8"
  })

  assert.equal(result.status, "ok")
  assert.match(result.prompt, /JSON object だけ/)
  assert.match(result.prompt, /docs\/requirements\.md/)
  assert.match(result.prompt, /src\/timeout\.c/)
  const written = await fs.readFile(result.promptPath, "utf8")
  assert.equal(written, result.prompt)
})
