import { ProjectChecklist } from "./types"

export interface ProjectRulesPacketOptions {
  checklist: ProjectChecklist
  schema: unknown
}

export function buildProjectRulesSection(options: ProjectRulesPacketOptions): string {
  return [
    "## Project-specific review rules",
    "",
    "Use the following checklist as mandatory review criteria.",
    "Do not mark a rule as pass without evidence.",
    "Use unknown when required source files, design docs, tables, or other evidence are missing.",
    "Every fail must produce at least one finding with the same rule_id.",
    "The primary output must be JSON matching the review result schema. After that, provide a Markdown summary.",
    "",
    "### Focused context allowance",
    "",
    "You may use focused additional context when the diff alone is insufficient.",
    "Allowed context methods: targeted text search, Tree-sitter, symbol search, outline, and Bazaar file content reads.",
    "Limit this to changed files, added files, symbols shown in the diff, public definitions added by the revision, and direct references relevant to checklist rules.",
    "Do not read broad unrelated areas of the repository. If required evidence would be too large, use unknown and explain what is missing.",
    "",
    "### checklist.json",
    "",
    "```json",
    JSON.stringify(options.checklist, null, 2),
    "```",
    "",
    "### review-result.schema.json",
    "",
    "```json",
    JSON.stringify(options.schema, null, 2),
    "```",
    "",
    "### Output contract",
    "",
    "Return results in this order:",
    "",
    "1. A fenced JSON block named `review_result_json` containing the normalized result.",
    "2. A human-readable Markdown checklist summary using these marks:",
    "   - `[x]` pass",
    "   - `[ ]` fail",
    "   - `[?]` unknown",
    "   - `[-]` not_applicable",
    "   - `[!]` blocked",
    "",
    "Status rules:",
    "",
    "- `pass`: evidence exists and no issue is found.",
    "- `fail`: project rule violation or high risk is found.",
    "- `unknown`: the diff suggests the rule may apply, but evidence is insufficient.",
    "- `not_applicable`: the rule clearly does not apply to this change.",
    "- `blocked`: a required tool, file, revision, or checklist cannot be loaded."
  ].join("\n")
}
