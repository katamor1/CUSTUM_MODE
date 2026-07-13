# `bob-evidence-scope` Phase 1 検証記録

日付: 2026-07-12

## 検証環境

- Node.js: `v22.16.0`
- npm: `10.9.2`
- TypeScript compiler: `5.8.3`
- Test runner: Node.js built-in `node:test`

## TDD evidence

### RED 1: domain modules are absent

Command:

```bash
node --test test/evidenceScope.test.js
```

Observed result:

```text
Error: Cannot find module '../out/evidenceScope/changeScopeEngine'
1 test file failed
```

The failure was caused by the missing production module, not by malformed test data.

### GREEN 1: core selection behavior

Command:

```bash
tsc -p ./ && node --test test/evidenceScope.test.js
```

Observed result after implementing the first domain modules:

```text
5 tests passed
0 failed
```

### RED 2: rule config and artifact modules are absent

Observed result after adding the next tests:

```text
Error: Cannot find module '../out/evidenceScope/projectRuleConfig'
1 test file failed
```

### GREEN 2: rule config and artifact serialization

Observed result:

```text
7 tests passed
0 failed
```

### RED 3: public domain boundary is absent

Observed result:

```text
Cannot find module '../out/evidenceScope'
7 tests passed
1 failed
```

### GREEN 3: public domain boundary

Command:

```bash
tsc -p ./ && node --test test/evidenceScope.test.js
```

Observed result:

```text
1..8
# tests 8
# pass 8
# fail 0
```

### RED 4: invalid depth and incomplete unknown-impact fingerprint

Two boundary tests exposed the following defects:

- `maxDependencyDepth: NaN` was not normalized, so direct dependencies were still selected.
- changing only an unresolved edge's reason did not change `scopeFingerprint`.

Observed result:

```text
# tests 10
# pass 8
# fail 2
```

### GREEN 4: final phase-1 suite

Command:

```bash
tsc -p ./ && node --test test/evidenceScope.test.js
```

Observed result:

```text
1..10
# tests 10
# pass 10
# fail 0
# duration_ms 120.536428
```

## Covered behavior

| Test | Verified behavior |
| --- | --- |
| deterministic dependency expansion | changed, direct, and two-hop priorities; reversed input ordering; stable fingerprint |
| unknown impact | unresolved dynamic edge retained with reason and target hint |
| rule applicability | path, language, symbol kind, risk tag, interface change |
| document evidence ranking | symbol link precedence, tag matching, duplicate ID handling |
| budget policy | required retention, high/medium budget exclusion, low-priority policy, required overflow |
| existing analysis adapter | current code-analysis and document-evidence types converted to scope input |
| rule config parser | snake_case configuration, normalization, invalid-rule diagnostics |
| artifact contract | deterministic schema, source revision, selection policy |
| public index | explicit stable domain exports |
| invalid depth normalization | non-finite dependency depth becomes zero |
| fingerprint completeness | unresolved edge reason participates in scope identity |

## Extension-wide local verification

The captured branch workspace was expanded locally, dependencies were installed from the committed lockfile, and the Phase 1 files were overlaid into the complete extension source tree.

| Check | Result |
| --- | --- |
| `npm ci --ignore-scripts --audit=false --fund=false` | 599 packages installed |
| `npm test` | 209 tests passed, 0 failed |
| `npm run dependency:policy` | 2 tests passed |
| `npm run architecture:policy` | 83 TypeScript files checked; no import cycles |
| `npm run source:policy` | 83 TypeScript files checked; no forbidden export-star usage |
| `npm run unused:report` | report-only tools completed with exit 0 |
| `npm run audit:prod` | 0 vulnerabilities |
| `npm run package` | VSIX generated |
| `npm run package:policy` | 3,650,672 bytes; 1,895 entries; policy passed |

The first extension-wide run exposed one existing source-layout contract: feature modules must not import a generic local `types.ts`. The domain type module was renamed to `evidenceScopeTypes.ts`, direct imports were updated, and the full 209-test suite then passed.

## Remaining CI verification

The existing GitHub Actions workflow still provides the authoritative Linux and Windows Extension Host smoke results after the commit reaches the feature branch. Those results are not claimed before the workflow completes.
