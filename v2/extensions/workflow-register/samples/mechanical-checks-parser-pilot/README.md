# Mechanical Checks Parser Pilot Sample

This sample runs three deterministic checks through `workflowRegister.runMechanicalChecks`:

- build warning/error delta with the `regex` parser
- static-analysis delta with the `sarif` parser and known IDs
- reviewed-file-list mismatch with the `csv` parser

## Smoke

Open this folder as the workflow workspace and run `mechanical-checks-parser-pilot`.

Expected result: `status: failed`. The fixtures intentionally contain:

- one new build warning
- one new SARIF finding, plus one known SARIF finding listed in `.bob/checks/known-static-analysis.txt`
- one CSV reviewed-file-list mismatch

Review these artifacts:

- `.bob/mechanical-checks/runs/<runId>/profile-result.json`
- `.bob/mechanical-checks/runs/<runId>/profile-summary.md`
- `.bob/mechanical-checks/runs/<runId>/checks/*/result.json`
- `.bob/mechanical-checks/runs/<runId>/checks/*/evidence/...`

## UAT

1. Run the workflow and confirm the profile status is `failed`.
2. Open the build check result and confirm `metrics.new_warnings` is `1`.
3. Open the SARIF check result and confirm `metrics.known_findings` is `1` and actionable finding `SA002` remains.
4. Open the CSV check result and confirm actionable finding `REV001` remains.
5. Remove the new warning/finding/mismatch from the fixture scripts and rerun; the profile should become `passed`.
