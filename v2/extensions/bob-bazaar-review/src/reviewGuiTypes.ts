export type TargetMode = "singleRevision" | "revisionRange" | "workingTreeSinceRevision"

export interface BazaarReviewInitialTarget {
  revisionMode?: TargetMode
  revision?: string
  baseRevision?: string
  targetRevision?: string
  bazaarRoot?: string
  repositoryRoot?: string
  workflowRoot?: string
}
