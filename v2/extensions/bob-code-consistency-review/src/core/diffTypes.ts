export type DiffSummary = {
  vcs?: "git" | "bazaar"
  vcsRoot?: string
  base: string
  head: string
  files: Array<{
    path: string
    status: "added" | "modified" | "deleted" | "renamed" | "unknown"
    additions?: number
    deletions?: number
    language?: string
    is_test?: boolean
    is_interface_candidate?: boolean
  }>
  unifiedDiff?: string
  warnings: string[]
}
