# AI Replacement Preview and Apply

Phase 15 adds a guarded flow for AI repair proposals that include `replacementMarkdown`.

## Flow

When `workflowRegister.improveWorkflowWithAi` receives a repair proposal with `replacementMarkdown`, workflow-register now follows this sequence:

```text
1. Validate replacementMarkdown with validateWorkflowText()
2. If invalid, show the report only
3. If valid, open a Markdown preview document
4. Write a comparison candidate under .bob/workflows/.previews/<workflow>/
5. Open a VS Code diff against the current WORKFLOW.md
6. Ask the user to Apply Replacement or Cancel
7. If Apply is selected, show a modal confirmation
8. Before overwrite, write a backup under .bob/workflows/.backups/<workflow>/
9. Overwrite the original WORKFLOW.md only after confirmation
```

## Backup path

Backups are written to:

```text
.bob/workflows/.backups/<workflow-name>/<yyyymmddThhmmssZ>-WORKFLOW.md
```

Example:

```text
.bob/workflows/.backups/review-docs/20260628T123456Z-WORKFLOW.md
```

## Preview path

Diff candidates are written to:

```text
.bob/workflows/.previews/<workflow-name>/<workflow-name>-<yyyymmddThhmmssZ>-replacement-WORKFLOW.md
```

These files are not workflow definitions and are not applied automatically.

## Safety rules

- Invalid `replacementMarkdown` is never previewed or applied.
- Valid replacement Markdown is still not auto-applied.
- The user must choose `Apply Replacement`.
- The user must confirm the modal warning.
- A backup is written before the original workflow file is overwritten.
- Cancel leaves the current workflow unchanged.

## Notes for AI providers

Providers should treat `replacementMarkdown` as a proposal only. workflow-register may reject, preview, or cancel the proposal. Providers should include concise `notes` that explain why the replacement is suggested.
