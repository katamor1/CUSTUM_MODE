export type ReviewInput = {
  schema_version: 1
  review: {
    id: string
    title: string
    change_type: string
    purpose: string
    base: string
    head: string
    vcs?: "git" | "bazaar" | "bzr"
    vcs_root?: string
    ticket_ids?: string[]
    author_note?: string
    out_of_scope?: string[]
  }
  artifacts: Record<string, unknown>
  review_focus: string[]
  analysis_options?: {
    include_callers?: boolean
    include_callees?: boolean
    include_global_access?: boolean
    include_struct_impact?: boolean
    include_ledgers?: boolean
    max_call_depth?: number
    max_code_context_lines?: number
    repository_symbol_index_path?: string
    repository_symbol_index_mode?: "consume" | "build"
    repository_symbol_index_cache_path?: string
    language?: string[]
  }
  bob_options?: Record<string, unknown>
}
