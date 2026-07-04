const assert = require("node:assert/strict")
const { test } = require("node:test")

const { buildSafeWorkflowOptions } = require("../out/workflowUserOptions")

test("safe workflow options keep only command-allowed user keys", () => {
  const options = buildSafeWorkflowOptions({
    commandId: "bobCodeConsistency.preprocess",
    inputs: {
      reviewInputPath: "review-input.yaml",
      reviewPackagePath: ".bob-review/review-package",
      textEncoding: "utf8"
    },
    args: {
      outDir: ".bob-review/alternate-package",
      maxRawDiffBytes: 1024
    },
    allowedKeys: ["reviewInputPath", "reviewPackagePath", "outDir", "textEncoding", "maxRawDiffBytes"]
  })

  assert.deepEqual(options, {
    reviewInputPath: "review-input.yaml",
    reviewPackagePath: ".bob-review/review-package",
    textEncoding: "utf8",
    outDir: ".bob-review/alternate-package",
    maxRawDiffBytes: 1024
  })
})

test("safe workflow options reject blocked execution keys from inputs or args", () => {
  assert.throws(
    () => buildSafeWorkflowOptions({
      commandId: "bobCodeConsistency.preprocess",
      inputs: { reviewInputPath: "review-input.yaml", workspaceRoot: "C:/outside" },
      args: { bzrPath: "C:/tools/evil-bzr.exe", diffFixturePath: "fixtures/diff.json" },
      allowedKeys: ["reviewInputPath"]
    }),
    /bobCodeConsistency\.preprocess workflow options are not allowed: bzrPath, diffFixturePath, workspaceRoot/
  )
})

test("safe workflow options drop command-unallowed keys that are not globally blocked", () => {
  const options = buildSafeWorkflowOptions({
    commandId: "bobCodeConsistency.captureBobOutput",
    inputs: {
      bobOutputPath: ".bob-review/bob-output/bob-output.yaml",
      reviewInputPath: "review-input.yaml"
    },
    args: { triagePath: ".bob-review/human-triage" },
    allowedKeys: ["bobOutputPath", "reviewPackagePath", "packageDir", "text"]
  })

  assert.deepEqual(options, {
    bobOutputPath: ".bob-review/bob-output/bob-output.yaml"
  })
})
