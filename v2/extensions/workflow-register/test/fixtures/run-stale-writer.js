const { FileRunStateStore } = require("../../out/core/runStateStore.js")

const [workspaceRoot, runId] = process.argv.slice(2)
const store = new FileRunStateStore({
  workspaceRoot,
  now: () => "2026-07-12T00:03:00.000Z",
  lockOptions: { timeoutMs: 2_000, heartbeatMs: 0 }
})

async function main() {
  const run = await store.loadRun(runId)
  if (!run) throw new Error(`run not found: ${runId}`)
  process.stdout.write("READY\n")
  await new Promise((resolve) => process.stdin.once("data", resolve))
  run.state.writer = "child"
  try {
    await store.saveRun(run)
    process.stdout.write("SAVED\n")
    process.exit(0)
  } catch (error) {
    process.stderr.write(`STALE:${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exit(1)
})
