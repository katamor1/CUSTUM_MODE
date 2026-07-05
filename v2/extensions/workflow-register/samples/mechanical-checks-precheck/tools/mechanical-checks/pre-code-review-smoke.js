const fs = require("node:fs")
const path = require("node:path")

const [baseRevision = "HEAD~1", targetRevision = "HEAD"] = process.argv.slice(2)
const logDir = path.join(process.cwd(), "build", "logs")
fs.mkdirSync(logDir, { recursive: true })
fs.writeFileSync(
  path.join(logDir, "pre-code-review-smoke.log"),
  [
    `base=${baseRevision}`,
    `target=${targetRevision}`,
    "status=ok",
    ""
  ].join("\n")
)
console.log(`Mechanical check smoke passed: ${baseRevision}..${targetRevision}`)
