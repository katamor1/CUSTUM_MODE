const { withWorkflowRunLock } = require("../../out/core/runtime/runLock.js")

const [workspaceRoot, runId] = process.argv.slice(2)
let release
const released = new Promise((resolve) => { release = resolve })
process.stdin.setEncoding("utf8")
process.stdin.once("data", () => release())

withWorkflowRunLock(workspaceRoot, runId, async () => {
  process.stdout.write("READY\n")
  await released
}, { timeoutMs: 2_000, heartbeatMs: 25 }).then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${error?.stack ?? error}\n`)
    process.exit(1)
  }
)
