const assert = require("node:assert/strict")
const { test } = require("node:test")

const { readSrc } = require("./helpers/sourceReader")

test("Operation Hub locks action buttons until the hub refreshes", () => {
  const source = readSrc("gui", "operationHubHtml.ts")

  assert.ok(source.includes("markActionPending(button)"))
  assert.ok(source.includes("button.dataset.pending === 'true'"))
  assert.ok(source.includes("button.setAttribute('aria-busy', 'true')"))
  assert.ok(source.includes("document.querySelectorAll('button[data-action]')"))
  assert.ok(source.includes("反映中…"))
  assert.equal(source.includes("button.disabled = false"), false)
})

test("Operation Hub refreshes Run Monitor when run state files change", () => {
  const source = readSrc("gui", "operationHubProvider.ts")

  assert.ok(source.includes("RUN_MONITOR_WATCH_PATTERNS"))
  assert.ok(source.includes(".bob/workflows/runs/**/run.json"))
  assert.ok(source.includes(".bob/workflows/runs/**/control.json"))
  assert.ok(source.includes("this.syncRunMonitorWatchers(model.home.workspaceRoots)"))
  assert.ok(source.includes("vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, pattern))"))
  assert.ok(source.includes("watcher.onDidChange(() => this.scheduleRefreshAll())"))
  assert.ok(source.includes("watcher.onDidCreate(() => this.scheduleRefreshAll())"))
})

test("Operation Hub schedules follow-up refreshes after action commands start", () => {
  const source = readSrc("gui", "operationHubProvider.ts")

  assert.ok(source.includes("ACTION_REFRESH_DELAYS_MS"))
  assert.match(
    source,
    /this\.scheduleActionRefreshes\(\)\s+await vscode\.commands\.executeCommand\(command, \.\.\.commandArgsForAction\(message\)\)/
  )
  assert.ok(source.includes("await this.refreshAll().catch"))
  assert.match(source, /await this\.openPanel\(message\.runId \? \{ runId: message\.runId \} : undefined\)\s+await this\.refresh\(\)/)
})
