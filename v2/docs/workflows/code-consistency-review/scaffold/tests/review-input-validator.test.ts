import test from "node:test";
import assert from "node:assert/strict";
import { validateReviewInput } from "../src/core/review-input-validator.js";

const fixtureRoot = "docs/workflows/code-consistency-review/scaffold/tests/fixtures";

test("validateReviewInput accepts valid fixture", async () => {
  const input = await validateReviewInput(`${fixtureRoot}/review-input.valid.yaml`);

  assert.equal(input.schema_version, 1);
  assert.equal(input.review.id, "REVIEW-FIXTURE-001");
  assert.equal(input.review.head, "docs/code-consistency-review-flow");
});

test("validateReviewInput rejects fixture without target ref", async () => {
  await assert.rejects(
    () => validateReviewInput(`${fixtureRoot}/review-input.invalid-missing-target.yaml`),
    /Invalid review-input\.yaml/,
  );
});
