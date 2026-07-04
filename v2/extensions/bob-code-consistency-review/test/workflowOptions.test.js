const assert = require("node:assert/strict")
const { test } = require("node:test")

const { buildCaptureWorkflowOptions } = require("../out/workflowOptions")

test("capture workflow options preserve configured output path while using Bob result state as text", () => {
  const options = buildCaptureWorkflowOptions({
    args: undefined,
    inputs: {
      bobOutputPath: ".custom/bob-output.yaml",
      reviewPackagePath: ".custom/review-package"
    },
    state: {
      bobReviewResult: "schema_version: 1\nreview_summary:\n  final_approval: not_performed\n"
    }
  })

  assert.deepEqual(options, {
    bobOutputPath: ".custom/bob-output.yaml",
    reviewPackagePath: ".custom/review-package",
    text: "schema_version: 1\nreview_summary:\n  final_approval: not_performed\n"
  })
})

test("capture workflow options prefer explicit text from args over state text", () => {
  const options = buildCaptureWorkflowOptions({
    args: { text: "schema_version: 1\nfrom: args\n" },
    inputs: { bobOutputPath: ".custom/bob-output.yaml" },
    state: { bobReviewResult: "schema_version: 1\nfrom: state\n" }
  })

  assert.equal(options.text, "schema_version: 1\nfrom: args\n")
  assert.equal(options.bobOutputPath, ".custom/bob-output.yaml")
})

test("capture workflow options preserve raw text args while keeping workflow inputs", () => {
  const options = buildCaptureWorkflowOptions({
    args: ["schema_version: 1\nfrom: raw args\n"],
    inputs: { bobOutputPath: ".custom/bob-output.yaml" },
    state: { bobReviewResult: "schema_version: 1\nfrom: state\n" }
  })

  assert.equal(options.text, "schema_version: 1\nfrom: raw args\n")
  assert.equal(options.bobOutputPath, ".custom/bob-output.yaml")
})

test("capture workflow options reject dangerous workflow execution keys", () => {
  assert.throws(
    () => buildCaptureWorkflowOptions({
      args: { text: "schema_version: 1\n", diffFixturePath: "fixtures/diff.json" },
      inputs: {
        bobOutputPath: ".custom/bob-output.yaml",
        workspaceRoot: "C:/outside"
      },
      state: {}
    }),
    /bobCodeConsistency\.captureBobOutput workflow options are not allowed: diffFixturePath, workspaceRoot/
  )
})
