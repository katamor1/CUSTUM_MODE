import type { WorkflowExecutionMode } from "./core/engineTypes"
import type { RunStatus } from "./core/model"
import { normalizeWorkspaceRootIdentity } from "./workspaceRootIdentity"

export interface BobWorkflowGateDecision {
  workspaceRoot: string
  runId: string
  stepId: string
  ownerStepId?: string
  status: RunStatus
  executionMode?: WorkflowExecutionMode
}

export type BobWorkflowGateAcceptResult = "accepted" | "alreadyAccepted" | "aborted" | "missing"

export interface BobWorkflowGateAcceptance {
  result: BobWorkflowGateAcceptResult
  gate?: BobWorkflowGateDecision & { ownerStepId: string }
}

type SettledGateOutcome = "accepted" | "aborted"

interface PendingGate {
  decision: BobWorkflowGateDecision & { ownerStepId: string }
  promise: Promise<boolean>
  reject: (reason: Error) => void
  resolve: (accepted: boolean) => void
}

export class BobWorkflowGateRegistry {
  private readonly pending = new Map<string, PendingGate>()
  private readonly settled = new Map<string, SettledGateOutcome>()
  private readonly settledRuns = new Map<string, SettledGateOutcome>()
  private disposed = false

  waitForDecision(input: BobWorkflowGateDecision): Promise<boolean> {
    const ownerStepId = input.ownerStepId ?? input.stepId
    const key = gateKey(input.workspaceRoot, input.runId, ownerStepId)
    const existing = this.pending.get(key)
    if (existing) return existing.promise
    if (this.disposed) return Promise.reject(new Error("Bob workflow gate registry is disposed."))
    this.settled.delete(key)
    this.settled.delete(gateKey(input.workspaceRoot, input.runId, input.stepId))
    this.settledRuns.delete(runKey(input.workspaceRoot, input.runId))

    let resolve!: PendingGate["resolve"]
    let reject!: PendingGate["reject"]
    const promise = new Promise<boolean>((resolveGate, rejectGate) => {
      resolve = resolveGate
      reject = rejectGate
    })
    this.pending.set(key, {
      decision: {
        ...input,
        ownerStepId
      },
      promise,
      reject,
      resolve
    })
    return promise
  }

  accept(workspaceRoot: string, runId: string, stepId: string): BobWorkflowGateAcceptResult {
    const entry = this.pendingEntryForGate(workspaceRoot, runId, stepId)
    if (!entry) {
      const key = gateKey(workspaceRoot, runId, stepId)
      const settled = this.settled.get(key)
      if (settled === "accepted") return "alreadyAccepted"
      return settled ?? "missing"
    }
    return this.acceptEntry(entry)
  }

  acceptWithMetadata(workspaceRoot: string, runId: string, stepId: string): BobWorkflowGateAcceptance {
    const entry = this.pendingEntryForGate(workspaceRoot, runId, stepId)
    if (!entry) return { result: this.accept(workspaceRoot, runId, stepId) }
    const gate = { ...entry[1].decision }
    return { result: this.acceptEntry(entry), gate }
  }

  private acceptEntry([key, gate]: [string, PendingGate]): BobWorkflowGateAcceptResult {
    this.pending.delete(key)
    this.rememberOutcome(key, gate, "accepted")
    gate.resolve(true)
    return "accepted"
  }

  acceptPending(workspaceRoot: string, runId: string): BobWorkflowGateAcceptResult {
    const entry = this.pendingEntryForRun(workspaceRoot, runId)
    if (entry) return this.acceptEntry(entry)
    const settled = this.settledRuns.get(runKey(workspaceRoot, runId))
    if (settled === "accepted") return "alreadyAccepted"
    return settled ?? "missing"
  }

  abort(workspaceRoot: string, runId: string, stepId: string, reason: string): boolean {
    const entry = this.pendingEntryForGate(workspaceRoot, runId, stepId)
    return entry ? this.abortEntry(entry, reason) : false
  }

  private abortEntry([key, gate]: [string, PendingGate], reason: string): boolean {
    this.pending.delete(key)
    this.rememberOutcome(key, gate, "aborted")
    gate.reject(new Error(reason))
    return true
  }

  abortPending(workspaceRoot: string, runId: string, reason: string): boolean {
    const entry = this.pendingEntryForRun(workspaceRoot, runId)
    return entry ? this.abortEntry(entry, reason) : false
  }

  pendingForRun(workspaceRoot: string, runId: string): BobWorkflowGateDecision & { ownerStepId: string } | undefined {
    const gate = this.pendingEntryForRun(workspaceRoot, runId)?.[1]
    return gate ? { ...gate.decision } : undefined
  }

  rebind(
    workspaceRoot: string,
    runId: string,
    decision: Pick<BobWorkflowGateDecision, "stepId" | "status">
  ): Promise<boolean> | undefined {
    const entry = this.pendingEntryForRun(workspaceRoot, runId)
    if (!entry) return undefined
    const [currentKey, gate] = entry
    const nextKey = gateKey(workspaceRoot, runId, decision.stepId)
    const conflict = [...this.pending.entries()].some(([key, candidate]) => (
      key !== currentKey
      && runKey(candidate.decision.workspaceRoot, candidate.decision.runId) === runKey(workspaceRoot, runId)
      && (candidate.decision.ownerStepId === decision.stepId || candidate.decision.stepId === decision.stepId)
    ))
    if (conflict) return undefined
    this.settled.delete(nextKey)
    gate.decision = {
      ...gate.decision,
      stepId: decision.stepId,
      status: decision.status
    }
    return gate.promise
  }

  isPending(workspaceRoot: string, runId: string, stepId: string): boolean {
    return Boolean(this.pendingEntryForGate(workspaceRoot, runId, stepId))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gates = [...this.pending.entries()]
    this.pending.clear()
    for (const [key, gate] of gates) {
      this.rememberOutcome(key, gate, "aborted")
      gate.reject(new Error("Bob workflow gate registry is disposed."))
    }
  }

  private pendingEntryForGate(workspaceRoot: string, runId: string, stepId: string): [string, PendingGate] | undefined {
    const ownerKey = gateKey(workspaceRoot, runId, stepId)
    const ownerGate = this.pending.get(ownerKey)
    if (ownerGate) return [ownerKey, ownerGate]
    const requestedRunKey = runKey(workspaceRoot, runId)
    const matches = [...this.pending.entries()].filter(([, gate]) => (
      runKey(gate.decision.workspaceRoot, gate.decision.runId) === requestedRunKey
      && gate.decision.stepId === stepId
    ))
    return matches.length === 1 ? matches[0] : undefined
  }

  private pendingEntryForRun(workspaceRoot: string, runId: string): [string, PendingGate] | undefined {
    const requestedRunKey = runKey(workspaceRoot, runId)
    const matches = [...this.pending.entries()].filter(([, gate]) => (
      runKey(gate.decision.workspaceRoot, gate.decision.runId) === requestedRunKey
    ))
    return matches.length === 1 ? matches[0] : undefined
  }

  private rememberOutcome(key: string, gate: PendingGate, outcome: SettledGateOutcome): void {
    this.settled.set(key, outcome)
    this.settled.set(gateKey(
      gate.decision.workspaceRoot,
      gate.decision.runId,
      gate.decision.stepId
    ), outcome)
    this.settledRuns.set(runKey(gate.decision.workspaceRoot, gate.decision.runId), outcome)
  }
}

function gateKey(workspaceRoot: string, runId: string, ownerStepId: string): string {
  return JSON.stringify([normalizeWorkspaceRoot(workspaceRoot), runId, ownerStepId])
}

function runKey(workspaceRoot: string, runId: string): string {
  return JSON.stringify([normalizeWorkspaceRoot(workspaceRoot), runId])
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return normalizeWorkspaceRootIdentity(workspaceRoot)
}
