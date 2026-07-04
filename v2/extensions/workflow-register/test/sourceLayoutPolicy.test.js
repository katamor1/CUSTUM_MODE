const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { extensionRoot, readSrc } = require("./helpers/sourceReader")

test("core workflow model types are split by responsibility with model.ts kept as a compatibility shim", () => {
  const expectedModelFiles = ["modelSchema.ts", "modelProviders.ts", "modelSinks.ts", "modelRuntime.ts"]
  for (const fileName of expectedModelFiles) {
    assert.ok(fs.existsSync(path.join(extensionRoot, "src", "core", fileName)), `${fileName} must exist`)
  }

  const modelSource = readSrc("core", "model.ts")
  for (const fileName of expectedModelFiles) {
    assert.match(modelSource, new RegExp(`from "\\./${path.basename(fileName, ".ts")}"`))
  }
  assert.doesNotMatch(
    modelSource,
    /^\s*export\s+(interface|type)\s+\w+/m,
    "core/model.ts must re-export responsibility-specific model files instead of owning declarations"
  )
})
