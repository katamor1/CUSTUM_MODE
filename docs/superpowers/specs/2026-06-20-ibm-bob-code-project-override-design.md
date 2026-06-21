# IBM Bob Code Project Override Design

**Status:** Approved on 2026-06-20

## Goal

Create a project-local `.bob/custom_modes.yaml` entry that overrides IBM Bob's built-in `code` mode while preserving the behavior and performance characteristics of the built-in mode shipped in Bob Code 3.26.6.

## Authoritative Source

The source of truth is the checked-in IBM Bob distribution:

- `org/bob-code/package.json`
- `org/bob-code/dist/extension.js`
- `org/bob-code/dist/extension.js.map`

The source map resolves the relevant bundled code to:

- `packages/types/src/mode.ts:153` — built-in mode definitions
- `shared/modes.ts:70` — custom mode lookup before built-in fallback
- `shared/modes.ts:89` — same-slug replacement in the merged mode list
- `shared/modes.ts:328` — custom prompt fields applied over the selected mode
- `core/config/CustomModesManager.ts:259` — project mode precedence over global mode
- `core/config/CustomModesManager.ts:402` — custom mode loading
- `core/prompts/sections/custom-instructions.ts:265` — `.bob/rules-{slug}` loading
- `core/prompts/system.ts:137` — `code` slug selects IBM's cost-effective prompt
- `ibm/core/prompts/sections/ibm-prompt.ts:18` — cost-effective prompt implementation

## Behavioral Findings

1. A project mode with the same slug replaces the complete mode object. It is not a field-level merge.
2. Project modes take precedence over global custom modes and built-in modes.
3. The optimized IBM Code prompt is selected by the literal slug `code`. A project override retaining this slug keeps that prompt path.
4. Tool availability is derived from `groups`; therefore the built-in `read`, `edit`, and `command` groups must remain unchanged for the baseline.
5. The built-in Code prompt hardcodes its core engineering role. `roleDefinition`, `whenToUse`, and `description` still need to match for UI behavior, orchestration, optional power-steering context, exports, and future compatibility.
6. Mode-specific project rules are additive. Any file in `.bob/rules-code/` changes the prompt, so the exact baseline must not add a rule file.
7. Prompt edits saved through Bob's settings UI are stored in global `customModePrompts` state and can override the project mode's prompt fields. Exact baseline testing requires those Code prompt overrides to be reset in Bob's UI.

## Project Files

### `.bob/custom_modes.yaml`

Contains one complete `code` mode definition copied from Bob Code 3.26.6. It intentionally omits:

- `source`, because Bob assigns `project` while loading the file;
- `customInstructions`, because the built-in Code mode has none;
- `.bob/rules-code/`, because any content there would no longer be a zero-difference baseline.

### `scripts/bob-code-baseline.mjs`

A dependency-free verifier that:

1. confirms the checked distribution is Bob Code 3.26.6;
2. extracts `DEFAULT_MODES` from the bundled extension;
3. parses the constrained project YAML format;
4. compares all behaviorally relevant Code mode fields;
5. confirms the `code`-specific optimized system-prompt branch is present;
6. fails explicitly when Bob is upgraded, forcing a reviewed re-baseline.

### `tests/bob-code-baseline.test.mjs`

Uses Node's built-in test runner to cover extraction, parsing, exact comparison, drift detection, and the actual project integration.

### `調査/ibm-bob-code-3.26.6-baseline.md`

Records the implementation evidence, precedence model, limitations, operating procedure, and the safe location for future modifications.

## Baseline Definition

The project override is considered equivalent when all these conditions hold:

- slug is exactly `code`;
- name, description, role definition, usage guidance, and groups equal Bob 3.26.6 defaults;
- no project `customInstructions` are present;
- no `.bob/rules-code/` content is present;
- the bundled `code` optimized prompt branch exists;
- no saved global Code prompt override remains in Bob settings.

The automated verifier proves every file-based condition. The final global-state condition is documented as a manual Bob UI check because extension global state is outside the project.

## Future Modification Boundary

After the zero-difference baseline is verified:

1. keep `.bob/custom_modes.yaml` identical to the extracted built-in definition;
2. add intentional behavior changes under `.bob/rules-code/`;
3. keep each rule small and independently reviewable;
4. rerun the baseline verifier after Bob upgrades;
5. use a separate behavioral test for intentional rules, since the exact-baseline verifier should continue to report that rules make the prompt non-identical.

## Acceptance Criteria

- The project YAML is accepted by Bob's custom mode schema.
- The project `code` mode equals the extracted Bob 3.26.6 built-in definition.
- The IBM optimized Code prompt branch remains selected.
- Tests demonstrate that changed fields and tool groups are detected.
- The research document clearly distinguishes automated proof from the manual global-state reset.

