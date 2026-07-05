const assert = require("node:assert/strict")
const { test } = require("node:test")

test("target request validation rejects unknown review modes", () => {
  const { parseTargetRequest, validateTargetRequest } = require("../out/bazaar/reviewTarget")
  const request = parseTargetRequest({
    mode: "unexpectedMode",
    baseRevision: "120"
  })

  assert.throws(
    () => validateTargetRequest(request),
    /Unsupported review mode/
  )
})
