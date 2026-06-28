# Workflow Template Catalog

`Create Workflow from Template` creates a validated `WORKFLOW.md` under `.bob/workflows/<name>/`.

## simple-agent

Use this for a one-step AI workflow.

Best for:

- Summaries
- Small analysis tasks
- First drafts

## command-then-agent

Runs one command, stores its result, then sends that state to an AI step.

Best for:

- Collecting workspace context
- Reading tool output before analysis
- Wrapping an existing VS Code command

Replace `example.commandId` before using it.

## manual-checklist

Creates a manual, step-by-step checklist.

Best for:

- Release checks
- Review checklists
- Human approval flows

## input-driven-agent

Prompts for typed inputs and uses them in an AI prompt.

Best for:

- Review scope selection
- Target file or topic selection
- Output style selection

## preflight-files

Adds `requires.files` and a preflight block before the workflow steps.

Best for:

- Workflows that need specific workspace files
- Setup checks
- Fail-fast workflow design

## artifact-output

Creates a report-producing workflow with an artifact declaration and result sink.

Best for:

- Markdown reports
- Generated design notes
- Review outputs

## guarded-command

Shows how to document allowed and denied commands.

Best for:

- Command execution workflows
- Risky operations that need approval
- Workflows meant to be reviewed before execution

Replace `example.safeCommand` before using it.

## review-workflow

Collects review context and runs an AI review step.

Best for:

- Code reviews
- Documentation reviews
- Workflow reviews

Replace `example.collectReviewContext` before using it.

## Choosing a template

- Start with `simple-agent` when the workflow only needs a prompt.
- Use `command-then-agent` when the workflow needs tool output.
- Use `input-driven-agent` when a user must provide parameters.
- Use `artifact-output` when the workflow should produce a file.
- Use `guarded-command` when command safety matters.
- Use `review-workflow` for structured review tasks.
