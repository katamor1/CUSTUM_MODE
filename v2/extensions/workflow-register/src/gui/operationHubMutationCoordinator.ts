import type { OperationHubActionId } from "./operationHubModel"

export type OperationHubMutationTargetKind = "run" | "workflow"

export interface OperationHubMutationIdentity {
  actionId: OperationHubActionId
  workspaceRoot: string
  targetKind: OperationHubMutationTargetKind
  targetId: string
  expectedRevision?: string
}

export class OperationHubMutationCoordinator {
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly targetTails = new Map<string, Promise<void>>()

  coordinate<T>(identity: OperationHubMutationIdentity, operation: () => Promise<T>): Promise<T> {
    const operationKey = mutationOperationKey(identity)
    const existing = this.operations.get(operationKey)
    if (existing) return existing as Promise<T>

    const targetKey = mutationTargetKey(identity)
    const prior = this.targetTails.get(targetKey)
    const owner = prior
      ? prior.then(operation, operation)
      : Promise.resolve().then(operation)
    let coordinated!: Promise<T>
    coordinated = owner.finally(() => {
      if (this.operations.get(operationKey) === coordinated) this.operations.delete(operationKey)
    })
    this.operations.set(operationKey, coordinated)

    const tail = coordinated.then(
      () => undefined,
      () => undefined
    )
    this.targetTails.set(targetKey, tail)
    void tail.finally(() => {
      if (this.targetTails.get(targetKey) === tail) this.targetTails.delete(targetKey)
    })
    return coordinated
  }
}

function mutationOperationKey(identity: OperationHubMutationIdentity): string {
  return JSON.stringify([
    identity.actionId,
    identity.workspaceRoot,
    identity.targetKind,
    identity.targetId,
    identity.expectedRevision
  ])
}

function mutationTargetKey(identity: OperationHubMutationIdentity): string {
  return JSON.stringify([
    identity.workspaceRoot,
    identity.targetKind,
    identity.targetId
  ])
}
