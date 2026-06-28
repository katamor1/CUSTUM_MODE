import test from "node:test";
import assert from "node:assert/strict";
import { collectGitDiff } from "../src/core/git-diff-collector.js";
import type { ReviewInput } from "../src/core/result.js";

const fixtureRoot = "docs/workflows/code-consistency-review/scaffold/tests/fixtures";

const reviewInput: ReviewInput = {
  schema_version: 1,
  review: {
    id: "REVIEW-FIXTURE-001",
    title: "fixture",
    change_type: "bugfix",
    purpose: "fixture",
    base: "main",
    head: "docs/code-consistency-review-flow",
  },
  artifacts: {
    requirements: [{ path: "fixture.md" }],
  },
  review_focus: ["requirement-code-consistency"],
};

test("collectGitDiff can load a diff summary fixture", async () => {
  const summary = await collectGitDiff(reviewInput, {
    diffFixturePath: `${fixtureRoot}/diff-summary.valid.json`,
  });

  assert.equal(summary.base, "fixture-base");
  assert.equal(summary.head, "fixture-head");
  assert.equal(summary.files.length, 1);
  assert.equal(summary.files[0]?.language, "c");
  assert.ok(summary.warnings.some((warning) => warning.includes("fixture")));
});
