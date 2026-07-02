const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

function tempDir(prefix = "workflow-register-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function fixedNow() {
  return "2026-06-28T00:00:00.000Z"
}

module.exports = { fixedNow, tempDir }
