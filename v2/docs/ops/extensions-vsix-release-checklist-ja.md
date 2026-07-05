# Extensions VSIX Release Checklist

- 対象拡張:
  - `extensions/workflow-register`
  - `extensions/bob-bazaar-review`
  - `extensions/bob-code-consistency-review`
- 目的: Phase 0 の品質 gate を通した VSIX だけを UAT / 実運用へ渡す。

## 1. Release 入力

| 項目 | 記録 |
|---|---|
| release date | |
| branch | |
| commit | |
| operator | |
| Node.js | |
| npm | |
| VS Code / Bob IDE | |

## 2. Clean Install

各拡張ディレクトリで実行する。

```powershell
npm.cmd ci
```

| 拡張 | 判定 | notes |
|---|---|---|
| workflow-register | | |
| bob-bazaar-review | | |
| bob-code-consistency-review | | |

## 3. Quality Gate

各拡張ディレクトリで実行する。

```powershell
npm.cmd test
npm.cmd run package
npm.cmd run package:policy
```

| 拡張 | test | package | package:policy | VSIX |
|---|---|---|---|---|
| workflow-register | | | | |
| bob-bazaar-review | | | | |
| bob-code-consistency-review | | | | |

repository root で実行する。

```powershell
git diff --check
git status --short
```

期待結果:

- `git diff --check` が成功する。
- 未コミット差分は release 対象か、生成された ignored VSIX のみである。
- `*.vsix` はコミットしない。

## 4. VSIX 内容確認

各拡張で `package:policy` の結果を確認する。追加で手動確認する場合は VSIX を zip として一覧化する。

確認観点:

| 観点 | ok 条件 |
|---|---|
| runtime files | `out/**`, `package.json`, 必要な schema/assets が含まれる。 |
| dependencies | runtime dependency が `.vscodeignore` で除外されていない。 |
| source | `src/**`, `test/**`, fixtures が不要に含まれていない。 |
| source maps | policy で許可したもの以外の `.map` が含まれていない。 |
| generated artifacts | `.bob-review/`, `.bob-trace/ai-traceability-draft/`, `.bob/workflows/runs/` が含まれていない。 |
| size | 拡張ごとの budget 内。 |

## 5. Smoke Install

UAT 用 VS Code / Bob IDE で確認する。

| 拡張 | 確認 | 判定 |
|---|---|---|
| workflow-register | Command Palette に `Bob ワークフロー:` commands が出る。 | |
| bob-bazaar-review | Command Palette に `Bazaar レビュー:` commands が出る。 | |
| bob-code-consistency-review | Command Palette に `コード整合レビュー:` commands が出る。 | |
| workflow-register | `.bob/workflows/*/WORKFLOW.md` を reload できる。 | |
| bob-bazaar-review | GUI を開ける。 | |
| bob-code-consistency-review | preprocess command が validation error なしで起動する。 | |

## 6. Compatibility Gate

次の識別子は変更していないことを確認する。

| 種別 | 確認方法 |
|---|---|
| VS Code command ID | `package.json` の contributes.commands diff を確認する。 |
| workflow action provider ID | `workflowProviderRegistration` の provider ID を確認する。 |
| workflow ID / name | `.bob/workflows/*/WORKFLOW.md` と bundled workflow を確認する。 |
| schema enum | review-input / bob-output / workflow schema の diff を確認する。 |
| Bob source ID | extension setting default と registration code を確認する。 |

## 7. Release 判定

| 判定 | 条件 |
|---|---|
| `ok` | 全 gate 成功。UAT へ渡せる。 |
| `ng` | test/package/policy/compatibility のいずれかが失敗。修正後に再実行する。 |
| `n/a` | 対象拡張を release しない場合のみ。理由を記録する。 |

## 8. Release 記録

| 拡張 | VSIX path | size | sha256 | 判定 | notes |
|---|---|---:|---|---|---|
| workflow-register | | | | | |
| bob-bazaar-review | | | | | |
| bob-code-consistency-review | | | | | |

## 9. Rollback

問題が出た場合は、直前に UAT 済みの VSIX set に戻す。

記録する内容:

- 問題が出た VSIX path / hash
- workspace path
- 再現手順
- error message / screenshot
- rollback 先 VSIX path / hash
- data cleanup の要否
