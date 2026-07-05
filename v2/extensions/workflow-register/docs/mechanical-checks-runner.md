# Mechanical Check Runner MVP

Mechanical Check Runner executes project-owned deterministic checks from `.bob/checks/mechanical-checks.yaml` through workflow command steps.

## Workflow Step

```yaml
steps:
  - id: run-mechanical-checks
    title: コードレビュー前の機械チェックを実行
    type: command
    action:
      provider: workflowRegister.runMechanicalChecks
      args:
        profile: pre-code-review
        baseRevision: "{{inputs.baseRevision}}"
        targetRevision: "{{inputs.targetRevision}}"
    resultKey: mechanicalCheckResult
    required: true
    completeOnSuccess: true
```

Use workflow transitions to stop the run when `mechanicalCheckResult.status` is `failed` or `blocked`.

## Configuration

Default path: `.bob/checks/mechanical-checks.yaml`.

Supported runner values:

- `bat`
- `powershell`
- `python`
- `node`
- `executable`

Supported parser values:

- `exit_code`
- `regex`
- `sarif`
- `csv`

Parser input can be `stdout`, `stderr`, or `evidence`. SARIF and CSV default to evidence files collected for the check.

Delta parser fields:

- `baseline_evidence`: workspace-relative evidence glob list for baseline output.
- `target_evidence`: workspace-relative evidence glob list for target output.
- `identity_columns`: finding identity columns such as `id`, `file`, `line`, `message`, `severity`, or `fingerprint`.

Known IDs:

- `pass_condition.allow_known_ids_file` points to a workspace-relative text file.
- Blank lines and `#` comments are ignored.
- Matching finding IDs or fingerprints are counted as `known_findings` and excluded from `new_findings`.

Paths must be workspace-relative. Absolute paths and `..` traversal are rejected for `command`, `cwd`, evidence collection, and known-warning files.

## Results

Each run writes:

- `.bob/mechanical-checks/runs/<runId>/profile-result.json`
- `.bob/mechanical-checks/runs/<runId>/profile-summary.md`
- `.bob/mechanical-checks/runs/<runId>/checks/<checkId>/stdout.log`
- `.bob/mechanical-checks/runs/<runId>/checks/<checkId>/stderr.log`
- `.bob/mechanical-checks/runs/<runId>/checks/<checkId>/result.json`
- `.bob/mechanical-checks/runs/<runId>/checks/<checkId>/evidence/...`

`passed`, `warning`, `failed`, and `blocked` are runner-owned statuses. Bob may summarize them, but the JSON result is the source of truth.

Structured parser results add:

- `findings`: actionable findings after baseline and known-ID filtering.
- `metrics.total_findings`: target finding count.
- `metrics.new_findings`: actionable finding count.
- `metrics.known_findings`: accepted known finding count.
- `metrics.violations`: gate violation count.

## CODEX Verification

Run from `extensions/workflow-register`:

```powershell
npm.cmd run compile
node --test test/mechanicalChecksConfig.test.js test/mechanicalChecksRunner.test.js test/mechanicalChecksActionProvider.test.js test/workflowSamples.test.js
```

For parser pilot coverage, also run:

```powershell
node --test test/mechanicalChecksParser.test.js
```

## Parser Pilot UAT

Use `samples/mechanical-checks-parser-pilot` for a runnable parser pilot:

- `build-warning-delta`: regex baseline/target log delta.
- `static-analysis-sarif-delta`: SARIF baseline/target delta with known IDs.
- `reviewed-file-list-match`: CSV reviewed-file-list mismatch.

The fixture intentionally fails. Confirm the result JSON reports one new warning, one actionable SARIF finding, one known SARIF finding, and one CSV mismatch.
