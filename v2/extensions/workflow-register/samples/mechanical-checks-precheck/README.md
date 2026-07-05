# Mechanical Checks Precheck Sample

This sample shows the Phase 4 Mechanical Check Runner MVP as a standalone workflow workspace.

## Files

- `.bob/checks/mechanical-checks.yaml`: `pre-code-review` profile.
- `.bob/workflows/mechanical-checks-precheck/WORKFLOW.md`: workflow command step using `workflowRegister.runMechanicalChecks`.
- `tools/mechanical-checks/pre-code-review-smoke.js`: deterministic local check that writes a log evidence file.

## Smoke

Open this sample folder as the workflow workspace, then run `mechanical-checks-precheck` from workflow-register. The run writes:

- `.bob/mechanical-checks/runs/<runId>/profile-result.json`
- `.bob/mechanical-checks/runs/<runId>/profile-summary.md`
- `.bob/mechanical-checks/runs/<runId>/checks/pre-code-review-smoke/stdout.log`
- `.bob/mechanical-checks/runs/<runId>/checks/pre-code-review-smoke/evidence/build/logs/pre-code-review-smoke.log`

Expected result: `status: passed`.

## MVP Limits

- GUI profile editing is out of scope for this MVP.
- This sample covers the original smoke profile. Use `samples/mechanical-checks-parser-pilot` for SARIF, CSV, delta, and known-ID parser fixtures.
- Runner blocks unsafe paths and missing scripts, but project teams must still review scripts for destructive operations before registering them.
