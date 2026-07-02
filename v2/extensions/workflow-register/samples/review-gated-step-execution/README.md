# Review-gated Step Execution Sample

This sample verifies `stepExecution.mode: engineSteps` plus `stepReview.enabled: true`.

## Manual smoke

1. Package the extension.

```powershell
cd extensions\workflow-register
npm.cmd run package
```

2. Copy this sample folder content into a temporary workspace root, preserving `.bob/workflows/review-gated-step-execution/WORKFLOW.md`.

3. Install the VSIX into an isolated Bob/VS Code extension directory.

4. Open the temporary workspace in Bob.

5. Run `Review-gated Step Execution`.

Expected:

- Bob shows `Collect input`, `Draft output`, and `Save final output` as separate visible steps.
- After `Collect input`, the run state in `.bob/workflows/runs/<runId>/run.json` is `reviewing`.
- `workflowRegister.runNextStep` refuses to advance while the current step is `reviewing`.
- `workflowRegister.acceptCurrentStep` marks the current step completed.
- `workflowRegister.runNextStep` then runs exactly the next pending step.
- `workflowRegister.retryCurrentStep` archives the rejected attempt in `steps[].attempts`.
