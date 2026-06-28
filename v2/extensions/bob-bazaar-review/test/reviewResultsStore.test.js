const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

async function writeResult(workspaceRoot, name, reviewId, mtime) {
  const dir = path.join(workspaceRoot, ".bob", "review", "results")
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${name}.json`)
  await fs.writeFile(filePath, JSON.stringify({ review_id: reviewId, summary: { pass: 1 } }, null, 2), "utf8")
  await fs.utimes(filePath, mtime, mtime)
  return filePath
}

test("review result store reads a review result by id", async () => {
  const { getReviewResult } = require("../out/projectRules/reviewResultsStore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-store-"))
  const filePath = await writeResult(workspaceRoot, "BRR-001", "BRR-001", new Date("2026-06-26T00:00:00Z"))

  const result = await getReviewResult(workspaceRoot, "BRR-001")

  assert.equal(result.path, filePath)
  assert.equal(result.result.review_id, "BRR-001")
})

test("review result store reads the latest review result by file mtime", async () => {
  const { getLatestReviewResult } = require("../out/projectRules/reviewResultsStore")
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bob-review-store-latest-"))
  await writeResult(workspaceRoot, "BRR-OLD", "BRR-OLD", new Date("2026-06-26T00:00:00Z"))
  const latestPath = await writeResult(workspaceRoot, "BRR-NEW", "BRR-NEW", new Date("2026-06-27T00:00:00Z"))

  const result = await getLatestReviewResult(workspaceRoot)

  assert.equal(result.path, latestPath)
  assert.equal(result.result.review_id, "BRR-NEW")
})
