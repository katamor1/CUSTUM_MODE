# Experimental Bob Start Workflow Card Procedure

This note documents the experimental implementation in `experiment-bob-workflow-card`.

## Goal

Try to show a third-party Bazaar review card in IBM Bob's `Start Workflow` UI.

## Probe result from Bob 2.0.0

The first probe showed these public extension export keys from `IBM.bob-code`:

```text
openNewTask
registerSource
setChatContent
setFindings
startTask
startWorkflow
```

This is useful because `registerSource` looks like the intended public entry point for companion extensions. `startWorkflow` is treated as an execution entry point, not a discovery/registration entry point.

A second experiment showed that this call succeeds:

```ts
api.registerSource("bob-bazaar-review", "Bob Bazaar Review")
```

and returns an object with these keys:

```text
register
id
_log
_configuration
_humanReadableName
_parts
_events
_enabled
```

That strongly suggests a two-step model:

1. `registerSource(sourceId, sourceName)` creates a Bob source.
2. `returnedSource.registerWorkflow(workflow)` registers a workflow under that source.

Static inspection of `bob2/bob-code/dist/extension.js` confirmed the built-in shape:

```text
Ai.Instance.registerSource("pull-request", "Pull Request").registerWorkflow(new CreatePrWorkflow)
Ai.Instance.registerSource("review", "Code Review").registerWorkflow(new ReviewWorkflow)
```

The returned source also has an internal `register` object, but calling that internal object directly bypasses the source `_parts` ownership list. Workflows registered that way can be accepted by the global registry yet still fail `entryIsEnabled(workflow.id)`, so they do not reliably appear in `Start Workflow`.

## Current implementation

The companion extension contributes two commands:

- `Bob Bazaar: Inspect Bob Workflow API`
- `Bob Bazaar: Register Experimental Bob Workflow Card`

`Inspect Bob Workflow API` activates `IBM.bob-code` through the VSCode extension API and prints the public `extension.exports` keys into a Markdown document.

`Register Experimental Bob Workflow Card` builds this workflow card:

```ts
{
  id: "bob-bazaar-review.bazaar-project-rule-review",
  sourceId: "bob-bazaar-review",
  slug: "bazaar-project-rule-review",
  type: "workflow",
  kind: "workflow",
  name: "Bazaar Project Rule Review",
  title: "Bazaar Project Rule Review",
  label: "Bazaar Project Rule Review",
  description: "Review a Bazaar revision or range against project-specific rules...",
  command: "bobBazaar.openReviewGui",
  vscodeCommand: "bobBazaar.openReviewGui",
  prompt: "Open the Bazaar Review GUI and run a project-rule review."
}
```

The command now uses Bob's source method directly:

```ts
const source = api.registerSource("bob-bazaar-review", "Bob Bazaar Review")
source.registerWorkflow(workflow)
```

The companion extension keeps normal startup registration idempotent inside one extension host process. Activation now registers silently, then schedules one delayed forced reconciliation because Bob's own git-dependent sources can initialize after the companion extension. The manual command also force-registers and reports the attempt list, so it can recover a stale or partially initialized Bob workflow registry.

The workflow object provides Bob's expected method shape:

```ts
getId()
getLabel()
getMenuLabel()
getDescription()
isEnabled(env)
getSteps()
getApprovalConfig()
```

The single workflow step opens the companion extension GUI with `bobBazaar.openReviewGui`.
Startup registration does not open a Markdown document. The explicit command reports every attempt in a Markdown result document. The user should check Bob's `Start Workflow` UI after a successful registration attempt or after reloading Bob when the extension install notification appears.

## How to test

1. Build and install the extension from this branch.
2. Reload Bob IDE / VSCode.
3. Run `Bob Bazaar: Inspect Bob Workflow API`.
4. Confirm that `registerSource` appears in the export keys.
5. Reload Bob if it reports that extensions changed on disk.
6. Open Bob's `Start Workflow` UI.
7. Check whether `Bazaar Project Rule Review` appears.
8. If it does not appear, run `Bob Bazaar: Register Experimental Bob Workflow Card`.
9. Read the generated attempt report and check the `IBM Bob.log` source line for `[source:bob-bazaar-review] Bazaar Project Rule Review workflow registered`.

## Expected outcomes

### Success

If Bob accepts `source.registerWorkflow(workflow)`, startup registration logs success and sets `bob-code.hasWorkflows` to true. The card may appear after opening or reloading the Start Workflow UI. The explicit command should produce a report with successful `registerSource(sourceId, sourceName)`, returned source diagnostics, `source.registerWorkflow(workflow)`, and `setContext(bob-code.hasWorkflows)` attempts.

### Partial success

If `registerSource` returns success but `source.registerWorkflow` is missing or fails, the returned source shape no longer matches Bob 2.0.0. Capture the attempt report and inspect Bob output/logs.

### Failure

If all attempts fail, the remaining options are:

1. Keep using Skill + custom mode.
2. Keep using the companion extension's GUI / command flow.
3. Patch or fork Bob itself.
4. Find an IBM-supported workflow source schema.

## Files changed

- `extensions/bob-bazaar-review/src/bobApiProbe.ts`
- `extensions/bob-bazaar-review/src/bobWorkflowRegistration.ts`
- `extensions/bob-bazaar-review/src/extension.ts`
- `extensions/bob-bazaar-review/package.json`
