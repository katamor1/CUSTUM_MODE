import { AsyncLocalStorage } from "async_hooks"
import { assertWorkflowRunStateWritable } from "../runStateStore"
import type { RunStateStore } from "../runStateStore"
import { normalizeWorkspaceRootIdentity } from "../../workspaceRootIdentity"

interface InFlightRunExecution {
  operationKey: string
  promise: Promise<unknown>
}

export class WorkflowRunExecutionCoordinator {
  private readonly inFlight = new Map<string, InFlightRunExecution>()
  private readonly activeRuns = new AsyncLocalStorage<ReadonlySet<string>>()

  coordinate<T>(
    workspaceScope: string,
    runId: string,
    operationKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = runExecutionKey(workspaceScope, runId)
    const activeRuns = this.activeRuns.getStore()
    if (activeRuns?.has(key)) {
      return Promise.reject(new Error(`Workflow run execution cannot re-enter the same run: ${runId}`))
    }
    const existing = this.inFlight.get(key)
    if (existing?.operationKey === operationKey) return existing.promise as Promise<T>
    if (existing) {
      const retry = () => this.coordinate(workspaceScope, runId, operationKey, operation)
      return existing.promise.then(retry, retry)
    }

    const executionChain = new Set(activeRuns)
    executionChain.add(key)
    const owner = Promise.resolve().then(() => this.activeRuns.run(executionChain, operation))
    let coordinated!: Promise<T>
    coordinated = owner.finally(() => {
      if (this.inFlight.get(key)?.promise === coordinated) this.inFlight.delete(key)
    })
    this.inFlight.set(key, { operationKey, promise: coordinated })
    return coordinated
  }

  isActive(workspaceScope: string, runId: string): boolean {
    return this.inFlight.has(runExecutionKey(workspaceScope, runId))
  }
}

const coordinator = new WorkflowRunExecutionCoordinator()
const anonymousStoreScopes = new WeakMap<object, string>()
let anonymousStoreSequence = 0

export function coordinateWorkflowRunExecution<T>(
  runStore: RunStateStore,
  runId: string,
  operationKey: string,
  operation: () => Promise<T>
): Promise<T> {
  return coordinator.coordinate(runStoreScope(runStore), runId, operationKey, () => {
    const execute = async () => {
      const run = await runStore.loadRun(runId)
      if (run) assertWorkflowRunStateWritable(run)
      return operation()
    }
    return runStore.withRunLock ? runStore.withRunLock(runId, execute) : execute()
  })
}

export function workflowRunExecutionActive(runStore: RunStateStore, runId: string): boolean {
  return coordinator.isActive(runStoreScope(runStore), runId)
}

export function workflowRunExecutionActiveForWorkspace(workspaceRoot: string, runId: string): boolean {
  return coordinator.isActive(workspaceRoot, runId)
}

function runStoreScope(runStore: RunStateStore): string {
  if (runStore.workspaceRoot) return normalizeWorkspaceRoot(runStore.workspaceRoot)
  const store = runStore as object
  const existing = anonymousStoreScopes.get(store)
  if (existing) return existing
  const created = `anonymous-run-store:${++anonymousStoreSequence}`
  anonymousStoreScopes.set(store, created)
  return created
}

function runExecutionKey(workspaceScope: string, runId: string): string {
  return JSON.stringify([normalizeWorkspaceRoot(workspaceScope), runId])
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  if (workspaceRoot.startsWith("anonymous-run-store:")) return workspaceRoot
  return normalizeWorkspaceRootIdentity(workspaceRoot)
}
