import test from "node:test";
import assert from "node:assert/strict";
import { validateBobOutput } from "../src/core/bob-output-validator.js";

const fixtureRoot = "docs/workflows/code-consistency-review/scaffold/tests/fixtures";

test("validateBobOutput accepts valid fixture", async () => {
  const report = await validateBobOutput({
    packageDir: ".tmp/review-package",
    bobOutputPath: `${fixtureRoot}/bob-output.valid.yaml`,
  });

  assert.deepEqual(report.errors, []);
});

test("validateBobOutput rejects finding without evidence", async () => {
  const report = await validateBobOutput({
    packageDir: ".tmp/review-package",
    bobOutputPath: `${fixtureRoot}/bob-output.invalid-missing-evidence.yaml`,
  });

  assert.ok(report.errors.length > 0);
});
