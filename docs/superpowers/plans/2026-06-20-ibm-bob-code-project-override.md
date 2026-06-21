# IBM Bob Code Project Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a project-local override that is behaviorally identical to IBM Bob Code 3.26.6's built-in `code` mode.

**Architecture:** Keep the override as a complete same-slug mode definition in `.bob/custom_modes.yaml`. Use a dependency-free Node verifier to extract the authoritative default from the checked IBM bundle and compare it with the project file, while separately checking the slug-specific optimized prompt path.

**Tech Stack:** IBM Bob custom-mode YAML, Node.js ES modules, Node built-in test runner, PowerShell verification commands.

---

### Task 1: Specify the exact baseline contract

**Files:**
- Create: `docs/superpowers/specs/2026-06-20-ibm-bob-code-project-override-design.md`
- Create: `docs/superpowers/plans/2026-06-20-ibm-bob-code-project-override.md`

- [x] **Step 1: Record authoritative source locations**

Document the source-map-resolved mode definition, merge precedence, rule loading, and optimized `code` branch.

- [x] **Step 2: Define exact-equivalence and manual preconditions**

State that empty `.bob/rules-code/` content and reset global `customModePrompts` are required for a zero-difference baseline.

- [x] **Step 3: Review for ambiguity**

Run:

```powershell
$placeholderPattern = @('TB' + 'D', 'TO' + 'DO', 'implement ' + 'later', 'fill in ' + 'details') -join '|'
Select-String -Path docs\superpowers\specs\2026-06-20-ibm-bob-code-project-override-design.md -Pattern $placeholderPattern
```

Expected: no matches.

### Task 2: Build the verifier through TDD

**Files:**
- Create: `tests/bob-code-baseline.test.mjs`
- Create: `scripts/bob-code-baseline.mjs`

- [x] **Step 1: Write failing tests**

The test module imports and exercises:

```javascript
import {
  extractDefaultModes,
  parseProjectModesYaml,
  compareMode,
  verifyBaseline,
} from "../scripts/bob-code-baseline.mjs"
```

Tests must cover:

- extraction of a JavaScript `DEFAULT_MODES` array containing template literals;
- parsing the constrained YAML used by the project;
- no differences for an exact Code copy;
- detection of changed groups and prompt fields;
- actual repository verification.

- [x] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --test tests\bob-code-baseline.test.mjs
```

Expected: failure because `scripts/bob-code-baseline.mjs` does not exist.

- [x] **Step 3: Implement the minimal verifier**

Implement:

```javascript
export function extractDefaultModes(bundleText) {}
export function parseProjectModesYaml(yamlText) {}
export function compareMode(expected, actual) {}
export function verifyBaseline(paths) {}
```

The CLI defaults must resolve these paths relative to the repository:

```text
org/bob-code/package.json
org/bob-code/dist/extension.js
.bob/custom_modes.yaml
```

- [x] **Step 4: Run unit tests**

Run:

```powershell
node --test tests\bob-code-baseline.test.mjs
```

Expected: unit tests pass; the repository integration test remains red until the project YAML exists.

### Task 3: Add the exact project override

**Files:**
- Create: `.bob/custom_modes.yaml`

- [x] **Step 1: Add the complete Code definition**

Create:

```yaml
customModes:
  - slug: code
    name: "💻 Code"
    roleDefinition: "You are Bob, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices."
    whenToUse: "Use this mode when you need to write, modify, or refactor code. Ideal for implementing features, fixing bugs, creating new files, or making code improvements across any programming language or framework. Does not support MCP or Browser tools."
    description: "Write and modify code"
    groups:
      - read
      - edit
      - command
```

- [x] **Step 2: Confirm GREEN**

Run:

```powershell
node --test tests\bob-code-baseline.test.mjs
node scripts\bob-code-baseline.mjs
```

Expected: all tests pass and the CLI reports exact Code mode equivalence plus detection of the optimized prompt path.

### Task 4: Publish the investigation and operating procedure

**Files:**
- Create: `調査/ibm-bob-code-3.26.6-baseline.md`

- [x] **Step 1: Document evidence and precedence**

Include the default values, project/global/built-in priority, whole-object replacement behavior, optimized Code path, and global prompt override caveat.

- [x] **Step 2: Document safe future modification**

State that intentional changes belong in `.bob/rules-code/` only after the zero-difference baseline is confirmed.

- [x] **Step 3: Run the full verification gate**

Run:

```powershell
node --test tests\bob-code-baseline.test.mjs
node scripts\bob-code-baseline.mjs
$placeholderPattern = @('TB' + 'D', 'TO' + 'DO', 'implement ' + 'later', 'fill in ' + 'details') -join '|'
Select-String -Path docs\superpowers\specs\*.md,docs\superpowers\plans\*.md,調査\ibm-bob-code-3.26.6-baseline.md -Pattern $placeholderPattern
```

Expected: test and verifier exit code 0; placeholder scan returns no matches.

## Execution Notes

- Commit steps are omitted because `C:\Users\stell\source\repos\CUSTUM_MODE` is not a Git repository.
- Worktree isolation is unavailable for the same reason.
- Do not add a file under `.bob/rules-code/` during baseline creation; Bob would load it into the prompt and invalidate exact equivalence.
