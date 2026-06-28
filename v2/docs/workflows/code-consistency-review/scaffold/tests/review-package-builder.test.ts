import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateReviewInput } from "../src/core/review-input-validator.js";
import { collectGitDiff } from "../src/core/git-diff-collector.js";
import { extractDocuments } from "../src/analyzers/document-extractor.js";
import { analyzeCppChanges } from "../src/analyzers/c-cpp-change-analyzer.js";
import { buildTraceability } from "../src/analyzers/traceability-builder.js";
import { buildReviewPackage } from "../src/core/review-package-builder.js";

const fixtureRoot = "docs/workflows/code-consistency-review/scaffold/tests/fixtures";

const requiredFiles = [
  "manifest.yaml",
  "input-normalized.json",
  "changed-files.json",
  "changed-symbols.json",
  "change-summary.md",
  "diff-context.md",
  "document-index.json",
  "document-excerpts.md",
  "traceability-map.md",
  "deterministic-checks.md",
  "evidence-index.json",
  "bob-input.md",
];

test("buildReviewPackage creates required review-package files", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "bob-review-package-"));

  try {
    const reviewInput = await validateReviewInput(`${fixtureRoot}/review-input.valid.yaml`);
    const diff = await collectGitDiff(reviewInput, {
      diffFixturePath: `${fixtureRoot}/diff-summary.valid.json`,
    });
    const documents = await extractDocuments(reviewInput);
    const codeAnalysis = await analyzeCppChanges(diff, reviewInput);
    const traceability = await buildTraceability({ reviewInput, documents, codeAnalysis, diff });

    await buildReviewPackage({
      outDir,
      reviewInput,
      diff,
      documents,
      codeAnalysis,
      traceability,
    });

    for (const fileName of requiredFiles) {
      await access(join(outDir, fileName));
    }

    const bobInput = await readFile(join(outDir, "bob-input.md"), "utf8");
    assert.match(bobInput, /整合プレレビュー入力/);
    assert.match(bobInput, /Foo_HandleTimeout|TODO_detect_changed_function/);

    const changedFiles = await readFile(join(outDir, "changed-files.json"), "utf8");
    assert.match(changedFiles, /foo_timeout_after_buggy\.c/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
