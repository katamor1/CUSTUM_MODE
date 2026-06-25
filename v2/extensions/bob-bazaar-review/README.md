# Bob Bazaar Review

`bob-bazaar-review` is a companion VSCode extension for IBM Bob. It does not modify `IBM.bob-code`. Instead, it registers a read-only Bazaar MCP server in the current workspace's `.bob/mcp.json` and provides helper commands that build Bazaar revision review packets for Bob.

## Commands

| Command | Description |
| --- | --- |
| `Bob Bazaar: Configure Bazaar MCP for Bob` | Writes a `bazaar` MCP server entry to `.bob/mcp.json`. |
| `Bob Bazaar: Review Bazaar Revision with Bob` | Runs `bzr log -r REV` and `bzr diff -c REV`, then opens a Bob review packet. |
| `Bob Bazaar: Review Bazaar Revision Range with Bob` | Runs `bzr diff -r BASE..TARGET`, then opens a Bob review packet. |

## MCP tools

The bundled MCP server exposes these read-only tools:

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

## Build

```bash
cd extensions/bob-bazaar-review
npm install
npm run compile
npm run package
```

Install the generated VSIX into Bob IDE / VSCode:

```bash
code --install-extension bob-bazaar-review-0.1.0.vsix
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
Bazaar revision 1234 をレビューしてください。
MCP tool `bazaar_diff_revision` で差分を取得し、重大度付きFindingとして整理してください。
```

## Security notes

- Bazaar is executed with `execFile` / argument arrays, not shell string interpolation.
- Revision strings and repository-relative paths are validated before command execution.
- The MCP server is read-only by design.
- Diff output has a configurable maximum size for review packet generation.
