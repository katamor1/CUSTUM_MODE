# Phase 1 Task 6 Recovery and Main Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a trustworthy GREEN `main` baseline, recover Phase 1 Task 6 as a product-only branch, satisfy its semantic-review contract, and merge one clean, formally approved pull request into `main`.

**Architecture:** Keep the user's staged `build.ps1` untouched in the primary checkout and perform all implementation in isolated worktrees. First merge a small baseline-gate repair, then apply the verified Task 6 product patch without any carrier payload or materialization workflow, repair current-envelope compatibility, run the authoritative isolated test gate, and publish a new product PR. Close the obsolete carrier/recovery PRs only after the product merge and post-merge verification succeed.

**Tech Stack:** Python 3.12+, `unittest`, JSON Schema Draft 2020-12, `jsonschema`, `referencing`, Git worktrees, GitHub Actions on Windows, GitHub pull requests.

## Global Constraints

- Do not modify, unstage, commit, or delete `C:\Users\stell\source\repos\unitTestRunner\build.ps1`; it is pre-existing user work staged on the primary `main` checkout.
- Do not implement in the primary checkout. Use sibling worktrees created from freshly fetched `origin/main`.
- `reports/review_decisions.json` remains the only approval authority. Markdown, CSV, `done`, file existence, and modification time cannot confer approval or GREEN state.
- Keep `REVIEW_DECISIONS`, `FUNCTION_DOSSIER`, and `DOSSIER_MANIFEST` current at 1.1.0 while retaining immutable 1.0 schemas and lossless compatible migration.
- Keep the CLI envelope at 1.0.0 and use `data.outcome`, `data.exit_code`, `data.details`, and `data.artifacts` as the public JSON result contract.
- Product C/H/DSW/DSP/LIB inputs remain read-only. Generated outputs belong outside the source checkout.
- Run every actual `tests/test_*.py` module serially in a fresh Python process; monolithic `unittest discover` is not authoritative for this repository.
- Every product PR must be based on the preceding approved merge, contain focused RED/GREEN evidence, pass all applicable repository gates, and receive a fresh review with Critical 0 and Important 0.
- Never merge PR #11, #12, #13, #14, #15, or #16. They are incomplete or carrier/recovery branches, not a clean product diff.

---

## Evidence Snapshot — 2026-07-13

### Integrated progress

| Plan area | Integrated tasks | State |
|---|---:|---|
| Phase 0 | 8 / 8 | Complete on `main` |
| Phase 1 | 5 / 8 | Tasks 1–5 merged; Task 6 candidate is not materialized; Tasks 7–8 not started |
| Phase 2 | 0 / 9 | Preflight only |
| Phase 3 | 0 / 6 | Legacy adapter exists, hardening tasks not complete |
| Phase 4 | 0 / 7 | Legacy reanalysis/suite pieces exist, hardening tasks not complete |
| Total | 13 / 38 (34.2%) | One of five phase gates complete |

Phase 1 is 5 / 8 integrated (62.5%). Merging Task 6 raises the master-plan count to 14 / 38 (36.8%). Merging Tasks 7 and 8 and passing Gate G1 raises it to 16 / 38 (42.1%).

### Local and GitHub state

- Local `main`, `origin/main`, and the integration branch all point to `b66790165a2d4f82943cd199b3b499e1f1725fc3` in the current checkout snapshot.
- The primary checkout is dirty only because `build.ps1` is staged.
- The authoritative local isolated run produced 111 modules, 521 tests, 3 skips, and 1 failing module: `tests.test_test_spec_consumers`.
- The failing assertion expects the old literal `spec-control-update`; the canonical fixture now emits the stable-ID-derived value `spec-fn_control_update_cdd351ecf31d`.
- GitHub PR #12 contains only an incomplete two-commit Task 6 slice and has failing CI.
- GitHub PR #14 is 25 commits ahead of `main`, but its 20 changed files are only `.github/bootstrap/**` payloads and materialization workflows. It has no formal reviews and failed all three associated workflows.
- GitHub PR #16 explicitly says “Do not merge this carrier PR.” Its materialization workflow reconstructed the intended product tree but stopped on four modules before publishing the product branch.
- GitHub comparison reports `codex/p1t6-review-decisions-c581` as identical to `main`; there is currently no product branch to merge.
- The recovered Task 6 candidate adds or modifies 35 product/test files and introduces six Task 6 test modules. Its isolated workflow failures were:
  - `tests.test_reanalysis_cli`: current dossier envelope was not normalized before reading `artifact_index`.
  - `tests.test_test_spec_consumers`: existing `main` expectation drift.
  - `tests.test_vc6_fixture_build_e2e`: existing test still expects a pre-v1 top-level CLI `status`.
  - `tests.test_wheel_contract`: the Ubuntu carrier environment used `--no-deps` while code directly imports `referencing`.
- The normal CI Python job still uses monolithic discovery despite the merged isolated-verification policy; PR #16 therefore also showed cascading Windows failures that are not an acceptable authoritative gate.

### Non-blocking future gap

The suite dashboard reads legacy `report.status` / `result.execution_status`, while current Python reports serialize `outcome`. Manifest, selection, tag execution, explicit all-GREEN, and the central dashboard exist, but Phase 4 suite status/history portability remains incomplete. Do not absorb that correction into Task 6; track it under Phase 4 after Gate G1.

---

### Task 1: Restore the `main` Baseline and Align CI with the Recorded Gate

**Files:**
- Modify: `tests/test_test_spec_consumers.py:51`
- Modify: `tests/test_vc6_fixture_build_e2e.py:70`
- Modify: `.github/workflows/ci.yml:67`
- Create: `docs/review/2026-07-13-phase1-baseline-gate.md`

**Interfaces:**
- Consumes: canonical TestSpec envelope `data.spec_id`; CLI result envelope 1.0.0; the isolated verification policy in `docs/superpowers/plans/preflight/README.md`.
- Produces: a clean `origin/main` baseline where every Python module passes in its own process and the host build E2E asserts the v1 CLI envelope.

- [ ] **Step 1: Create an isolated baseline worktree without touching staged user work**

Run from `C:\Users\stell\source\repos\unitTestRunner` after invoking `superpowers:using-git-worktrees`:

```powershell
git fetch origin main
git worktree add C:\Users\stell\source\repos\unitTestRunner-baseline-gate `
  -b codex/p1-baseline-gate origin/main
Set-Location C:\Users\stell\source\repos\unitTestRunner-baseline-gate
git status --short --branch
```

Expected: branch `codex/p1-baseline-gate`, no worktree changes, base `b667901` or a newer fetched `origin/main` descendant.

- [ ] **Step 2: Capture the two intended RED failures**

```powershell
$env:PYTHONPATH = (Resolve-Path .\src).Path
py -m unittest tests.test_test_spec_consumers -v
py -m unittest tests.test_vc6_fixture_build_e2e -v
```

Expected on the current baseline:

- `test_test_spec_consumers` fails because a stable-ID-derived canonical fixture is compared with `spec-control-update`.
- The VC6 E2E either skips when no host compiler is installed or fails on a compiler-equipped runner because `probe_payload["status"]` is not part of CLI envelope 1.0.0.

- [ ] **Step 3: Make the TestSpec consumer test verify normalization rather than an obsolete fixture literal**

Replace the literal assertion with the canonical envelope value:

```python
canonical = json.loads(path.read_text(encoding="utf-8"))
payload = load_test_spec_for_consumer(path)

self.assertEqual(canonical["data"]["spec_id"], payload["spec_id"])
self.assertEqual(
    canonical["data"]["test_cases"][0]["test_case_id"],
    payload["test_cases"][0]["test_case_id"],
)
```

This keeps the test focused on lossless envelope normalization and generated-view rejection.

- [ ] **Step 4: Make the host build E2E assert CLI envelope 1.0.0**

Replace the obsolete top-level status assertion with:

```python
probe_payload = json.loads(probe.stdout)
self.assertEqual("passed", probe_payload["data"]["outcome"])
self.assertEqual(0, probe_payload["data"]["exit_code"])
self.assertEqual(
    "succeeded",
    probe_payload["data"]["details"]["build_probe"]["status"],
)
```

- [ ] **Step 5: Replace the monolithic CI Python command with serial isolated processes**

Use this PowerShell body in `.github/workflows/ci.yml`:

```yaml
      - name: Run Python tests in isolated processes
        shell: pwsh
        run: |
          $log = Join-Path $env:RUNNER_TEMP "python-tests.log"
          $modules = Get-ChildItem -LiteralPath .\tests -Filter 'test_*.py' -File |
            Sort-Object Name |
            ForEach-Object { 'tests.' + $_.BaseName }
          $failed = @()
          foreach ($module in $modules) {
            "`n=== $module ===" | Tee-Object -FilePath $log -Append
            & python -m unittest $module -v *>&1 |
              Tee-Object -FilePath $log -Append
            if ($LASTEXITCODE -ne 0) { $failed += $module }
          }
          "isolated_modules=$($modules.Count) failures=$($failed.Count)" |
            Tee-Object -FilePath $log -Append
          if ($failed.Count -ne 0) {
            throw ('isolated Python failures: ' + ($failed -join ', '))
          }
```

Keep the existing failure-log upload step and artifact name.

- [ ] **Step 6: Verify the focused baseline fixes**

```powershell
py -m unittest tests.test_test_spec_consumers -v
py -m unittest tests.test_cli_result_contract -v
py -m unittest tests.test_ci_contract -v
```

Expected: all pass. Run `tests.test_vc6_fixture_build_e2e` on a compiler-equipped machine or CI and require a real pass, not a skip, before merge.

- [ ] **Step 7: Run the authoritative baseline gate**

```powershell
$modules = Get-ChildItem -LiteralPath .\tests -Filter 'test_*.py' -File |
  Sort-Object Name |
  ForEach-Object { 'tests.' + $_.BaseName }
$failed = @()
foreach ($module in $modules) {
  & py -m unittest $module -v
  if ($LASTEXITCODE -ne 0) { $failed += $module }
}
if ($failed.Count -ne 0) {
  throw ('isolated Python failures: ' + ($failed -join ', '))
}
py -m compileall -q src tests
py -m unit_test_runner --help
git diff --check
```

Expected: every module passes; local platform skips are recorded explicitly; `compileall`, CLI help, and diff check exit 0.

- [ ] **Step 8: Record evidence and commit the baseline repair**

Write `docs/review/2026-07-13-phase1-baseline-gate.md` with base SHA, focused RED output, module/test/skip totals, CI run URL, limitations, and final SHA.

```powershell
git add .github/workflows/ci.yml `
  tests/test_test_spec_consumers.py `
  tests/test_vc6_fixture_build_e2e.py `
  docs/review/2026-07-13-phase1-baseline-gate.md
git commit -m "fix: restore phase 1 verification baseline"
```

- [ ] **Step 9: Open, review, and merge the baseline PR**

Use the GitHub publish workflow to open `codex/p1-baseline-gate -> main`. Require all six CI jobs, including a non-skipped VC6 fixture smoke, to pass. Obtain a fresh review with no Critical or Important findings, then merge with a merge commit. Fetch the resulting `origin/main` before starting Task 2.

---

### Task 2: Recover the Task 6 Product Diff and Restore Compatibility

**Files:**
- Modify: `src/unit_test_runner/build_probe.py`
- Modify: `src/unit_test_runner/cli/commands.py`
- Modify: `src/unit_test_runner/cli/parser.py`
- Modify: `src/unit_test_runner/contracts/migrations.py`
- Modify: `src/unit_test_runner/contracts/registry.py`
- Modify: `src/unit_test_runner/contracts/validator.py`
- Modify: `src/unit_test_runner/dossier/artifact_collector.py`
- Modify: `src/unit_test_runner/dossier/dossier_models.py`
- Modify: `src/unit_test_runner/dossier/dossier_writer.py`
- Modify: `src/unit_test_runner/dossier/finalizer.py`
- Modify: `src/unit_test_runner/dossier/readiness.py`
- Create: `src/unit_test_runner/dossier/review_assessment.py`
- Create: `src/unit_test_runner/dossier/review_decision_models.py`
- Create: `src/unit_test_runner/dossier/review_decision_repository.py`
- Modify: `src/unit_test_runner/dossier/review_workflow.py`
- Create: `src/unit_test_runner/review_ids.py`
- Modify: `src/unit_test_runner/schemas/common.schema.json`
- Modify: `src/unit_test_runner/schemas/dossier_manifest.schema.json`
- Create: `src/unit_test_runner/schemas/dossier_manifest_v1_0.schema.json`
- Modify: `src/unit_test_runner/schemas/function_dossier.schema.json`
- Create: `src/unit_test_runner/schemas/function_dossier_v1_0.schema.json`
- Modify: `src/unit_test_runner/schemas/review_decisions.schema.json`
- Create: `src/unit_test_runner/schemas/review_decisions_v1_0.schema.json`
- Modify: `src/unit_test_runner/test_spec/generation.py`
- Modify: `src/unit_test_runner/reanalysis/workflow.py`
- Modify: `pyproject.toml`
- Modify: `tests/test_build_probe.py`
- Modify: `tests/test_contract_migrations.py`
- Modify: `tests/test_contract_registry.py`
- Modify: `tests/test_contract_validation.py`
- Create: `tests/test_dossier_readiness.py`
- Create: `tests/test_dossier_review_authority.py`
- Modify: `tests/test_dossier_review_workflow.py`
- Create: `tests/test_review_decision_cli.py`
- Create: `tests/test_review_decision_integration.py`
- Create: `tests/test_review_decision_staleness.py`
- Create: `tests/test_review_decisions.py`
- Modify: `tests/test_reanalysis_cli.py`
- Modify: `tests/test_wheel_contract.py`

**Interfaces:**
- Consumes: Task 5 canonical `test_spec.json`; immutable execution/evidence artifacts; current artifact registry; recovered product patch SHA-256 `8aaa74a87b2e1ea64087726bbcbfd8c998d5940c458d04768b63f969fe461ef0`.
- Produces: stable review IDs, exact subject fingerprints, atomic review decision persistence, four independent readiness axes, `get-review-status`, `record-review-decision`, and current/legacy dossier compatibility.

- [ ] **Step 1: Create the product worktree from the merged baseline**

```powershell
Set-Location C:\Users\stell\source\repos\unitTestRunner
git fetch origin main codex/bootstrap-p1t6-v3
git worktree add C:\Users\stell\source\repos\unitTestRunner-p1t6-main-merge `
  -b codex/p1t6-review-decisions-main-merge origin/main
Set-Location C:\Users\stell\source\repos\unitTestRunner-p1t6-main-merge
git status --short --branch
```

Expected: clean branch based on the merged Task 1 commit.

- [ ] **Step 2: Reconstruct and verify the carrier's product patch in the temporary directory**

```powershell
$parts = git ls-tree -r --name-only origin/codex/bootstrap-p1t6-v3 -- `
  .github/bootstrap/p1t6-v3-b64 | Sort-Object
$base64 = -join ($parts | ForEach-Object {
  (git show ('origin/codex/bootstrap-p1t6-v3:' + $_)).Trim()
})
$archive = Join-Path $env:TEMP 'unitTestRunner-p1t6.patch.gz'
$patch = Join-Path $env:TEMP 'unitTestRunner-p1t6.patch'
[IO.File]::WriteAllBytes($archive, [Convert]::FromBase64String($base64))
$archiveHash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
if ($archiveHash -ne '121bfc6fdcbb6e8728402997f291a0ef3af000d775d3c8bca791e0de28d13123') {
  throw "Unexpected compressed patch hash: $archiveHash"
}
$input = [IO.File]::OpenRead($archive)
$gzip = [IO.Compression.GZipStream]::new(
  $input,
  [IO.Compression.CompressionMode]::Decompress
)
$output = [IO.File]::Create($patch)
$gzip.CopyTo($output)
$output.Dispose(); $gzip.Dispose(); $input.Dispose()
$patchHash = (Get-FileHash -Algorithm SHA256 $patch).Hash.ToLowerInvariant()
if ($patchHash -ne '8aaa74a87b2e1ea64087726bbcbfd8c998d5940c458d04768b63f969fe461ef0') {
  throw "Unexpected product patch hash: $patchHash"
}
git apply --check $patch
git apply $patch
git diff --check
```

Expected: the patch applies without carrier files. Do not copy `.github/bootstrap/**` or any `materialize-p1t6*.yml` workflow into the product branch.

- [ ] **Step 3: Capture candidate RED evidence on the repaired baseline**

```powershell
$env:PYTHONPATH = (Resolve-Path .\src).Path
py -m unittest tests.test_reanalysis_cli -v
py -m unittest tests.test_vc6_fixture_build_e2e -v
py -m unittest tests.test_wheel_contract -v
```

Expected before compatibility repair:

- Reanalysis loses the previous source hash because it reads current-envelope fields at the root.
- The compiler-equipped fixture E2E exercises the corrected CLI assertion from Task 1 and exposes only real product failures.
- Wheel import behavior is evaluated against declared dependency closure rather than an ambient user-site package.

- [ ] **Step 4: Normalize legacy and current dossiers at the reanalysis boundary**

Add `ArtifactKind` to the existing contract import and normalize once:

```python
from unit_test_runner.contracts import ArtifactKind, ContractMode


def _dossier_data(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("artifact_kind") != ArtifactKind.FUNCTION_DOSSIER.value:
        return payload
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Current function dossier is missing its data object.")
    return data


def _payloads_from_previous_dossier(
    dossier_path: Path,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, Path]]:
    dossier = _dossier_data(_read_json(dossier_path))
    payloads: dict[str, dict[str, Any]] = {}
    paths: dict[str, Path] = {}
    for key in (
        "source_digest",
        "function_location",
        "function_signature",
        "global_access",
        "call_report",
        "coverage_design",
        "boundary_equivalence_candidates",
        "test_spec",
    ):
        path = _artifact_json_path(dossier, key, dossier_path)
        if path is None:
            continue
        paths[key] = path
        raw_payload = _read_json(path)
        if key == "test_spec":
            spec = load_test_spec(path, mode=ContractMode.COMPATIBLE)
            payloads["test_case_design"] = test_spec_consumer_payload(spec)
        else:
            payloads[key] = raw_payload
    if "build_context" in dossier:
        payloads["build_context"] = {
            "schema_version": "0.1",
            "build_context": dossier["build_context"],
        }
    return dossier, payloads, paths
```

Resolve relative current-envelope workspace roots against the dossier location:

```python
def _artifact_index_root(dossier: dict[str, Any], dossier_path: Path) -> Path:
    workspace_root = dossier.get("workspace_root")
    if isinstance(workspace_root, str) and workspace_root:
        root = Path(workspace_root).expanduser()
        if not root.is_absolute():
            dossier_root = (
                dossier_path.parent.parent
                if dossier_path.parent.name == "reports"
                else dossier_path.parent
            )
            root = dossier_root / root
        return root.resolve()
    if dossier_path.parent.name == "reports":
        return dossier_path.parent.parent.resolve()
    return dossier_path.parent.resolve()
```

- [ ] **Step 5: Lock the current-envelope reanalysis regression**

Extend `test_reanalyze_function_reads_finalized_previous_dossier_artifact_index` to assert the finalized artifact is current and its relative workspace root remains usable:

```python
finalized = json.loads(
    (previous_out / "reports" / "function_dossier.json").read_text(
        encoding="utf-8"
    )
)
self.assertEqual("function_dossier", finalized["artifact_kind"])
self.assertEqual("1.1.0", finalized["schema_version"])
self.assertEqual(".", finalized["data"]["workspace_root"])
self.assertEqual(
    previous_digest["source"]["sha256"],
    impact["previous_snapshot"]["source_sha256"],
)
```

- [ ] **Step 6: Declare the directly imported schema dependency**

Change the project dependencies to:

```toml
dependencies = [
  "jsonschema>=4.23,<5",
  "referencing>=0.28.4,<1",
]
```

Add `os` and `venv` imports, then update the installed-wheel test so runtime importability is checked with declared dependencies:

```python
import os
import venv


def _venv_python(root: Path) -> Path:
    venv.create(root, with_pip=True)
    if os.name == "nt":
        return root / "Scripts" / "python.exe"
    return root / "bin" / "python"


def test_installed_wheel_loads_every_artifact_specific_schema_resource(self):
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        wheel = _build_wheel(root / "dist", self)
        python = _venv_python(root / "venv")
        installed = subprocess.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                str(wheel),
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertEqual(0, installed.returncode, installed.stdout)
        script = """
import json
from importlib import resources
from unit_test_runner.contracts import ArtifactKind
from unit_test_runner.contracts.registry import get_contract

root = resources.files("unit_test_runner.schemas")
common = json.loads(root.joinpath("common.schema.json").read_text(encoding="utf-8"))
assert common["additionalProperties"] is False
for kind in ArtifactKind:
    contract = get_contract(kind)
    document = json.loads(
        root.joinpath(contract.schema_resource).read_text(encoding="utf-8")
    )
    assert "data" in document["allOf"][-1]["properties"]
"""
        loaded = subprocess.run(
            [str(python), "-I", "-c", script],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
    self.assertEqual(0, loaded.returncode, loaded.stdout)
```

Do not use `--no-deps` for the installation whose purpose is to verify runtime importability.

- [ ] **Step 7: Run focused RED/GREEN modules**

```powershell
py -m unittest `
  tests.test_reanalysis_cli `
  tests.test_wheel_contract `
  tests.test_build_probe `
  -v
```

Expected: all pass. On a compiler-equipped environment, also require `tests.test_vc6_fixture_build_e2e` to pass without skip.

- [ ] **Step 8: Commit the recovered, compatibility-safe product slice**

```powershell
git add pyproject.toml src tests
git commit -m "feat: recover phase 1 review decisions"
```

Expected: the commit contains product and test paths only; no carrier payload or materialization workflow is tracked.

---

### Task 3: Prove Task 6 Semantics and Record the Completion Boundary

**Files:**
- Modify: `docs/superpowers/plans/2026-07-11-unit-test-runner-phase-1-contract-execution-evidence.md`
- Modify: `docs/superpowers/plans/preflight/phase1-task-6-preflight.md`
- Modify: `docs/superpowers/plans/preflight/README.md`
- Create: `docs/review/2026-07-13-phase1-task6-completion.md`

**Interfaces:**
- Consumes: Task 6 repository, assessment, schemas, CLI commands, exact Task 1 baseline SHA, and all focused verification output.
- Produces: reviewable proof that Task 6 meets every preflight semantic rule and a single restart boundary for Task 7.

- [ ] **Step 1: Run the complete Task 6 focused suite**

```powershell
$env:PYTHONPATH = (Resolve-Path .\src).Path
py -m unittest `
  tests.test_review_decisions `
  tests.test_review_decision_staleness `
  tests.test_dossier_readiness `
  tests.test_review_decision_cli `
  tests.test_review_decision_integration `
  tests.test_dossier_review_authority `
  -v
```

Expected: stable IDs survive reordering/localization; collisions fail closed; stale writers and stale subjects write nothing; compatible migration is lossless and display-only; only exact current approved/waived decisions complete review; four readiness axes remain independent.

- [ ] **Step 2: Run Task 1–5 regression modules**

```powershell
py -m unittest `
  tests.test_contract_migrations `
  tests.test_contract_registry `
  tests.test_contract_validation `
  tests.test_dossier_contract_status `
  tests.test_dossier_review_workflow `
  tests.test_execution_run_history `
  tests.test_evidence_integrity `
  tests.test_prepare_evidence_non_destructive `
  tests.test_test_spec_contract `
  tests.test_test_spec_repository `
  tests.test_cli_result_contract `
  -v
```

Expected: all pass with immutable 1.0 schemas still loadable and TestSpec exact bytes unchanged.

- [ ] **Step 3: Exercise discovery and write CLI commands through one ephemeral workspace**

```powershell
$smoke = Join-Path $env:TEMP `
  ('unitTestRunner-p1t6-smoke-' + [Guid]::NewGuid().ToString('N'))
py -m unit_test_runner --json analyze-function `
  --workspace .\tests\fixtures\vc6_project `
  --dsw .\tests\fixtures\vc6_project\Product.dsw `
  --source src/control.c `
  --function Control_Update `
  --configuration 'Win32 Debug' `
  --project Control `
  --out $smoke `
  --finalize-dossier | Out-Null
$status = py -m unit_test_runner --json get-review-status `
  --workspace $smoke | ConvertFrom-Json
$details = $status.data.details
$item = $details.items | Select-Object -First 1
if ($null -eq $item) { throw 'Task 6 smoke produced no review item.' }
$decidedAt = [DateTimeOffset]::UtcNow.ToString('o')
py -m unit_test_runner --json record-review-decision `
  --workspace $smoke `
  --review-id $item.review_id `
  --resolution approved `
  --reviewer ci-smoke `
  --rationale 'Phase 1 Task 6 CLI smoke decision.' `
  --decided-at $decidedAt `
  --expected-revision $details.ledger_revision `
  --expected-subject-fingerprint $item.subject_fingerprint | Out-Null
$after = py -m unit_test_runner --json get-review-status `
  --workspace $smoke | ConvertFrom-Json
if ($after.data.details.ledger_revision -ne 1) {
  throw 'Task 6 smoke ledger revision did not advance exactly once.'
}
```

Expected: one exact `review_decisions` ProducedArtifact is returned by the write command; the ledger revision advances from 0 to 1; unrelated readiness axes do not become true merely because one decision was recorded.

- [ ] **Step 4: Run the authoritative full and packaging gates**

```powershell
$modules = Get-ChildItem -LiteralPath .\tests -Filter 'test_*.py' -File |
  Sort-Object Name |
  ForEach-Object { 'tests.' + $_.BaseName }
$failed = @()
foreach ($module in $modules) {
  & py -m unittest $module -v
  if ($LASTEXITCODE -ne 0) { $failed += $module }
}
if ($failed.Count -ne 0) {
  throw ('isolated Python failures: ' + ($failed -join ', '))
}
py -m compileall -q src tests
py -m unit_test_runner --help
py -m pip wheel --no-deps --wheel-dir .\.superpowers\dist .
py -m unittest tests.test_wheel_contract -v
git diff --check
git status --short --branch
```

Expected: all actual modules pass; schema resources load from a normally installed fresh wheel; CLI help and compileall exit 0; only intended tracked changes and ignored `.superpowers` evidence remain.

- [ ] **Step 5: Update the progress boundary only after GREEN**

In the Phase 1 plan, mark Tasks 2–6 completion checkboxes according to their merged/verified state; do not mark Tasks 7–8. In the Task 6 preflight, replace “not started” with the verified product SHA and link the completion record. In the handoff README, make Task 6 the approved restart baseline and direct the next branch to Phase 1 Task 7.

- [ ] **Step 6: Write the completion record**

`docs/review/2026-07-13-phase1-task6-completion.md` must include:

- old and new base/head SHAs;
- recovered patch hashes and product file list;
- exact schema current/retained versions;
- focused RED and GREEN results;
- isolated module/test/skip/failure/error totals;
- wheel/fresh-install, CLI smoke, fixture, compileall, and diff results;
- GitHub Actions run URLs;
- formal reviewer verdict and resolved findings;
- the fact that carrier files are excluded from the product diff.

- [ ] **Step 7: Commit the verified documentation boundary**

```powershell
git add docs/superpowers/plans `
  docs/review/2026-07-13-phase1-task6-completion.md
git commit -m "docs: record phase 1 task 6 completion gate"
```

---

### Task 4: Publish One Clean Product PR and Obtain Formal Approval

**Files:**
- Review: complete `origin/main...codex/p1t6-review-decisions-main-merge` diff
- Verify absence: `.github/bootstrap/**`
- Verify absence: `.github/workflows/materialize-p1t6*.yml`

**Interfaces:**
- Consumes: clean Task 6 branch, completion record, all local gate evidence.
- Produces: one mergeable GitHub PR whose head contains only the baseline-descended Task 6 product work.

- [ ] **Step 1: Freeze and inspect the exact product diff**

```powershell
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git diff --check origin/main...HEAD
git diff --name-status origin/main...HEAD
$forbidden = git diff --name-only origin/main...HEAD |
  Select-String '^\.github/(bootstrap/|workflows/materialize-p1t6)'
if ($forbidden) { throw "Carrier files found in product diff: $forbidden" }
git status --porcelain
```

Expected: clean worktree, no forbidden carrier files, and only Task 6 plus its verified compatibility/documentation changes.

- [ ] **Step 2: Push and open a draft product PR**

Use `github:yeet` at execution time. Suggested title:

```text
Complete Phase 1 Task 6 review decisions and semantic readiness
```

The PR body must name the exact base/head SHAs, completion record, schema versions, isolated test totals, six CI jobs, and the excluded carrier PRs. Base is `main`; head is `codex/p1t6-review-decisions-main-merge`.

- [ ] **Step 3: Require all GitHub checks to pass**

Required jobs:

- Source integrity
- Python tests in isolated processes
- VS Code unit tests
- VS Code Extension Host activation
- VC6 fixture smoke
- Package contract

If a job fails, inspect it with `github:gh-fix-ci`, add a focused regression, and rerun the complete relevant local gate before pushing.

- [ ] **Step 4: Obtain a fresh formal review**

Review the complete base-to-head product diff, not the carrier patch or an earlier tree. Resolve every Critical and Important finding, rerun focused and full gates after fixes, and obtain a new verdict with Critical 0 and Important 0. Resolve every GitHub review thread before marking ready.

- [ ] **Step 5: Mark the PR ready only when the merge gate is true**

The ready transition requires:

- branch still based on current `main`;
- all required checks GREEN;
- no unresolved review threads;
- formal verdict recorded in the completion document;
- `git diff --check` and worktree cleanliness confirmed;
- PR diff contains no carrier payload/workflow.

---

### Task 5: Merge, Reverify `main`, and Remove Recovery Debris

**Files:**
- Verify: complete merged `main` tree
- Close after verification: GitHub PRs `#11`, `#12`, `#13`, `#14`, `#15`, `#16`
- Remove after comparison: obsolete `codex/bootstrap-*`, `codex/p1t6-upload-*`, `codex/p1t6-patch-*`, and superseded `codex/p1t6-review-decisions-readiness` remote branches

**Interfaces:**
- Consumes: ready, approved, GREEN product PR.
- Produces: verified `main`, one durable Task 6 merge boundary, and no ambiguous open recovery PRs.

- [ ] **Step 1: Merge with a merge commit**

Use GitHub's merge-commit method so the independently reviewed Task 6 boundary remains visible. Record the merge SHA in `docs/review/2026-07-13-phase1-task6-completion.md` in a follow-up documentation commit only if the merge process cannot populate it before merge.

- [ ] **Step 2: Verify the remote merge without touching the dirty primary checkout**

```powershell
Set-Location C:\Users\stell\source\repos\unitTestRunner-p1t6-main-merge
git fetch origin main
git switch --detach origin/main
$mergeSha = git log origin/main --merges `
  --grep='Complete Phase 1 Task 6 review decisions and semantic readiness' `
  -1 --format=%H
if (-not $mergeSha) { throw 'Task 6 merge commit was not found on origin/main.' }
git merge-base --is-ancestor $mergeSha origin/main
$env:PYTHONPATH = (Resolve-Path .\src).Path
py -m compileall -q src tests
py -m unit_test_runner --help
git diff --check ($mergeSha + '^1') $mergeSha
```

Then rerun the focused Task 6 modules and the authoritative isolated full gate from Task 3. Expected: all pass from the merged `origin/main` tree.

- [ ] **Step 3: Confirm GitHub post-merge state**

Use the GitHub app to verify:

- the product PR is merged into `main`;
- the merge SHA is the current or ancestral `main` commit;
- all associated checks are successful;
- no review thread remains unresolved.

- [ ] **Step 4: Close obsolete open PRs with explicit reasons**

After the product merge is verified:

- close #11, #13, #14, #15, and #16 as recovery/carrier PRs that must never be merged;
- close #12 as the superseded incomplete Task 6 slice;
- link each closure comment to the merged product PR and merge SHA.

- [ ] **Step 5: Delete only branches proven to contain no unique required product commit**

For every recovery branch, compare it with merged `main`. Delete the branch only when its unique commits are carrier payload/workflow, obsolete incomplete code, or byte-for-byte represented by the merged product diff. Preserve any branch that fails that proof and record the exception.

- [ ] **Step 6: Remove temporary worktrees after final evidence is saved**

```powershell
Set-Location C:\Users\stell\source\repos\unitTestRunner
git worktree remove C:\Users\stell\source\repos\unitTestRunner-baseline-gate
git worktree remove C:\Users\stell\source\repos\unitTestRunner-p1t6-main-merge
git worktree prune
git worktree list
git status --short --branch
```

Expected: temporary worktrees are gone and the primary checkout still shows the user's original staged `build.ps1` untouched.

---

## Goals and Exit Criteria

### Goal A — Immediate baseline

- All actual baseline Python modules pass in isolated processes.
- VC6 fixture smoke passes on GitHub's compiler-equipped Windows runner.
- CI uses the same isolated policy documented in the repository.
- The primary checkout's staged `build.ps1` is unchanged.

### Goal B — Task 6 merged

- Stable review IDs and exact subject fingerprints are shared by dossier and TestSpec.
- Review decisions are revision-checked, atomic, stale-aware, and solely authoritative from `reports/review_decisions.json`.
- `ready_for_review`, `review_complete`, `evidence_ready`, and `test_green` are independently computed.
- Only `RunOutcome.PASSED` is GREEN.
- All current/retained schemas, CLI smoke, fresh wheel, fixture, and isolated full gates pass.
- One clean product PR is approved and merged; no carrier file reaches `main`.

### Goal C — Phase 1 Gate G1

After Task 6 is merged, execute the existing preflight plans in order:

1. Phase 1 Task 7: VS Code adoption of canonical contracts.
2. Phase 1 Task 8: public policy, phase, completion-loop, timeout, and traceability closure.
3. Gate G1: all Phase 1 completion checks and full Windows CI are GREEN.

Do not begin Phase 2 product work until Gate G1 is satisfied and Tasks 6–8 each have their own approved merge boundary.

## Self-Review Results

- Spec coverage: Task 6 preflight semantics, current GitHub recovery state, baseline drift, CI alignment, formal review, merge, post-merge verification, and carrier cleanup are all assigned to explicit tasks.
- Placeholder scan: no deferred implementation marker is used; commands, paths, expected failures, and acceptance results are concrete.
- Type consistency: CLI envelope paths, schema versions, branch names, review command arguments, and readiness-axis names match the current Task 6 candidate and preflight contracts.
- Scope: suite dashboard contract drift is recorded but intentionally deferred to Phase 4; Task 7/8 implementation is not mixed into Task 6.
