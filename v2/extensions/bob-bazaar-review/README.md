# Bob Bazaar Review

`bob-bazaar-review` is a companion VSCode extension for IBM Bob. It does not modify `IBM.bob-code`. Instead, it registers a read-only Bazaar MCP server in the current workspace's `.bob/mcp.json` and provides helper commands that build Bazaar revision review packets for Bob.

## Commands

| Command | Description |
| --- | --- |
| `Bob Bazaar: Configure Bazaar MCP for Bob` | Writes a `bazaar` MCP server entry to `.bob/mcp.json`. |
| `Bob Bazaar: Initialize Project Review Rules` | Creates `.bob/review/checklist.json` and `.bob/review/review-result.schema.json` when missing. |
| `Bob Bazaar: Review Bazaar Revision with Bob` | Runs `bzr log -r REV` and `bzr diff -c REV`, then opens a Bob review packet. |
| `Bob Bazaar: Review Bazaar Revision Range with Bob` | Runs `bzr diff -r BASE..TARGET`, then opens a Bob review packet. |
| `Bob Bazaar: Review Bazaar Revision with Project Rules` | Adds project checklist and JSON output contract to the Bob review packet. |
| `Bob Bazaar: Review Bazaar Revision Range with Project Rules` | Adds project checklist and JSON output contract to a range review packet. |
| `Bob Bazaar: Validate Project Review Result JSON` | Validates normalized review JSON from the active editor or selection and can render Markdown. |

## MCP tools

The bundled MCP server exposes these read-only Bazaar tools:

| Tool | Bazaar operation |
| --- | --- |
| `bazaar_root` | `bzr root` |
| `bazaar_revno` | `bzr revno` |
| `bazaar_log` | `bzr log` / `bzr log -r REV` |
| `bazaar_diff_revision` | `bzr diff -c REV` |
| `bazaar_diff_range` | `bzr diff -r BASE..TARGET` |
| `bazaar_diff_working_tree` | `bzr diff` / `bzr diff -r BASE` |
| `bazaar_cat_revision` | `bzr cat -r REV PATH` |
| `bazaar_status` | `bzr status` |

The server intentionally does not expose mutating commands such as `commit`, `push`, `pull`, `update`, `revert`, `merge`, or `resolve`.

The same MCP server also exposes project-rule helpers:

| Tool | Description |
| --- | --- |
| `project_rules_init` | Creates default `.bob/review` rule files when missing. |
| `project_rules_get_checklist` | Returns the project checklist JSON. |
| `project_rules_get_schema` | Returns the review result JSON schema. |
| `project_rules_validate_review_result` | Validates normalized review result JSON. |
| `project_rules_render_markdown` | Renders normalized review result JSON as a Markdown checklist. |

## Project rule files

The default layout is:

```text
.bob/
  review/
    checklist.json
    review-result.schema.json
```

`checklist.json` is the project-specific review rule source of truth. Example shape:

```json
{
  "version": "1.0.0",
  "project": "legacy-control",
  "rules": [
    {
      "id": "RT-001",
      "category": "realtime",
      "title": "RTスレッド内でI/Oを行っていない",
      "description": "RT_INPUT, RT_CONTROL, RT_OUTPUTではファイルI/O、標準出力、ログ出力、待ち処理を行わない。",
      "severity_on_fail": "error",
      "applies_when": ["changed_file_matches:src/rt_*.c", "diff_contains:RT_CONTROL"],
      "evidence_required": true,
      "review_hint": "I/O関数、ログ関数、sleep/wait、mutex待ち、動的確保を重点確認する。"
    }
  ]
}
```

Bob is instructed to return JSON first, then a Markdown checklist. The JSON is the authoritative output; Markdown `[x]` is only a human-readable rendering.

Status values:

| Status | Markdown mark | Meaning |
| --- | --- | --- |
| `pass` | `[x]` | Evidence exists and no issue is found. |
| `fail` | `[ ]` | Project rule violation or high risk is found. |
| `unknown` | `[?]` | Evidence is insufficient. |
| `not_applicable` | `[-]` | The rule clearly does not apply. |
| `blocked` | `[!]` | A required tool, file, revision, or rule cannot be loaded. |

## Build

```bash
cd extensions/bob-bazaar-review
npm install
npm run compile
npm run package
```

Install the generated VSIX into Bob IDE / VSCode:

```bash
code --install-extension bob-bazaar-review-0.2.0.vsix
```

## Configure Bob MCP

Open a Bazaar workspace and run:

```text
Bob Bazaar: Configure Bazaar MCP for Bob
```

The extension writes a workspace-local config like this:

```json
{
  "mcpServers": {
    "bazaar": {
      "command": "<node executable>",
      "args": ["<extension>/out/mcp/server.js"],
      "env": {
        "BZR_PATH": "bzr"
      },
      "disabled": false
    }
  }
}
```

Restart or refresh Bob MCP servers after changing `.bob/mcp.json`.

## Example prompt for Bob

```text
Bazaar revision 1234 をプロジェクト規約付きでレビューしてください。
MCP tool `bazaar_diff_revision` で差分を取得し、`project_rules_get_checklist` と `project_rules_get_schema` を使って、正規化JSONとMarkdownチェックリストを出してください。
```

## Security notes

- Bazaar is executed with `execFile` / argument arrays, not shell string interpolation.
- Revision strings and repository-relative paths are validated before command execution.
- The MCP server is read-only by design for Bazaar operations.
- Diff output has a configurable maximum size for review packet generation.
- A checklist result with `pass` or `fail` requires evidence during validation.
- Every failed rule must have at least one finding with the same `rule_id`.
