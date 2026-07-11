const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSourceSet } = require("./helpers/sourceReader")

test("traceability commands carry text encoding into catalog and review-input flows", () => {
  const source = readSourceSet(["traceabilityCommands.ts", "reviewExecutionCommands.ts"])

  assert.match(source, /const textEncoding = stringOption\(record, "textEncoding"\)/)
  assert.match(source, /prepareAiTraceabilityDraftPrompt\(\{[\s\S]*textEncoding[\s\S]*\}\)/)
  assert.match(source, /parseAiTraceabilityDraft\(text\)/)
  assert.match(source, /JSON\.stringify\(draft, null, 2\)/)
  assert.match(source, /applyAiTraceabilityDraft\(\{ workspaceRoot, catalogPath, text, textEncoding \}\)/)
  assert.match(source, /validateAndWriteTraceabilityGateReport\(\{ workspaceRoot, catalogPath, reportPath, textEncoding \}\)/)
  assert.match(source, /const limits = \{/)
  // The process boundary must carry encoding, bounded limits, timeout, and cancellation as one contract.
  assert.match(source, /preprocessReview\(\{[\s\S]*textEncoding,[\s\S]*limits,[\s\S]*workflowRunId,[\s\S]*commandTimeoutMs,[\s\S]*abortSignal: controller\.signal[\s\S]*\}\)/)
})

test("traceability commands reuse review metadata and focus options from shared helpers", () => {
  const source = readSourceSet(["traceabilityCommands.ts", "reviewInputWizard.ts", "extensionCommandOptions.ts"])

  assert.match(source, /import \{ collectReviewMetadata \} from "\.\/reviewInputWizard"/)
  assert.match(source, /reviewFocusOption\(record\) \?\? \["requirement-code-consistency", "design-code-consistency", "test-gap"\]/)
  assert.match(source, /writeReviewInputFromDraft\(\{[\s\S]*strictPaths: booleanOption\(record, "strictPaths"\) \?\? true[\s\S]*\}\)/)
})
