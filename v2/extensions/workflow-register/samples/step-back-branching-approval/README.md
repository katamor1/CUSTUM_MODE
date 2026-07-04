# Step-back Branching Approval Sample

This sample verifies a workflow that can return from a preapproval check or user approval step back to an earlier manual input step.

## Manual Smoke

1. Package the extension.

```powershell
cd extensions\workflow-register
npm.cmd run package
```

2. Copy this sample folder content into a temporary workspace root, preserving `.bob/workflows/step-back-branching-approval/WORKFLOW.md`.

3. Install the VSIX into an isolated Bob/VS Code extension directory.

4. Open the temporary workspace in Bob.

5. Run `Step-back Branching Approval`.

Expected:

- Bob shows `Collect user input`, `Generate draft`, `Preapproval check`, `User approval`, and `Write final draft` as engine steps.
- `Preapproval check` writes `preapproval.status: ng` to return to `Collect user input`.
- `User approval` writes `userApproval.decision: rejected` to return to `Collect user input`.
- The loop stops at `checkpoint` after five back transitions.
- `workflowRegister.approveBranchCheckpoint` allows five more back transitions.
- `workflowRegister.abortBranchCheckpoint` fails the run instead of resuming automatically.
