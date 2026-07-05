# Bob Workflow Security and Privacy Operations

- 対象: Phase 0 の 3 拡張
- 読者: 運用者、レビュー担当者、拡張機能メンテナー
- 原則: trusted workspace 前提でも、command、path、cwd、revision は防御的に検証する。

## 1. 信頼境界

| 境界 | 許可 | 禁止 / 拒否 |
|---|---|---|
| Workflow file | `.bob/workflows/<name>/WORKFLOW.md` | workspace 外、hidden workflow folder、Windows 予約名、trailing dot/space |
| Workflow run state | `.bob/workflows/runs/` | 任意 path への run state 保存 |
| Bazaar MCP | `BOB_BAZAAR_ALLOWED_ROOTS` 内の cwd | allowed root 外、write tool の既定有効化 |
| Bazaar CLI | `bzr --no-aliases <command>` | alias 影響を受ける `bzr diff`, `bzr log`, `bzr status` 直呼び |
| Code consistency package | `.bob-review/<review-package-dir>` | absolute path、`..`、`.bob-review/bob-output`、`.bob-review/human-triage` |
| Bob output capture | `.bob-review/bob-output/*.yaml` | review package 直下や workspace 外への保存 |
| Human triage | `.bob-review/human-triage/` | review package や任意 docs 配下への保存 |
| Traceability catalog | `.bob-trace/*.json` | `.bob-review/`、`.bob-trace/ai-traceability-draft/` |
| Traceability gate report | `.bob-trace/*.md` | `.bob-review/`、draft 作業領域 |
| Traceability AI draft prompt | `.bob-trace/ai-traceability-draft/` | workspace 外、catalog/report 領域 |

## 2. 運用前チェック

| 項目 | コマンド / 確認 | 期待結果 |
|---|---|---|
| workflow-register test | `npm.cmd test` in `extensions/workflow-register` | all pass |
| bob-bazaar-review test | `npm.cmd test` in `extensions/bob-bazaar-review` | all pass |
| bob-code-consistency-review test | `npm.cmd test` in `extensions/bob-code-consistency-review` | all pass |
| package smoke | `npm.cmd run package` in each extension | VSIX generated |
| VSIX policy | `npm.cmd run package:policy` in each extension | budget and content policy pass |
| diff check | `git diff --check` | no whitespace errors |

## 3. Workflow Authoring

GUI Builder、AI improvement、手動編集のいずれでも保存対象は `.bob/workflows/<name>/WORKFLOW.md` に限定する。

運用者は次を確認する。

| 確認 | 期待 |
|---|---|
| workflow folder name | `name` と同じ安定 ID。英数字、`.`、`_`、`-` のみ。 |
| backup | edit / improve は同一 workflow folder 内に backup を残す。 |
| validation | 保存前に workflow schema validation が通る。 |
| command guardrail | `vscode.executeCommand` は allowlist なしで実行しない。 |
| task snapshots | `taskSnapshots.includeMessages` は既定 `false`。必要時だけ明示的に有効化する。 |

## 4. Privacy Handling

生成物には社内設計書、顧客仕様、ソースコード、raw diff、Bob 出力が含まれる可能性がある。

| 領域 | 内容 | 既定の扱い |
|---|---|---|
| `.bob/workflows/runs/` | workflow state, step status, artifact path | ignore 推奨 |
| `.bob/workflows/runs/**/task-snapshots/` | Bob task metadata, optional messages | ignore 必須。messages は既定保存しない。 |
| `.bob/review/results/` | Bazaar review-result JSON/Markdown | ignore または project policy に従う。 |
| `.bob-review/` | review package, Bob output, triage | ignore 必須。 |
| `.bob-trace/ai-traceability-draft/` | AI draft prompt/output | ignore 必須。 |
| `.bob-trace/traceability-catalog.json` | sidecar traceability | project policy に従い versioning 可。 |
| `.bob-trace/gate-report.md` | gate validation report | project policy に従い versioning 可。 |

推奨 `.gitignore`:

```gitignore
.bob/workflows/runs/
.bob/review/results/
.bob-review/
.bob-trace/ai-traceability-draft/
```

## 5. Incident Response

| 事象 | 初動 | 記録 |
|---|---|---|
| workspace 外へ保存されそうになった | 操作を中止し、入力 option と error message を保存する。 | command, option, error |
| Bob output に機密情報が含まれた | `.bob-review/bob-output/` を共有しない。必要なら redaction 後に再生成する。 | affected path, owner |
| task snapshot に message を含めた | `includeMessages` を無効に戻し、snapshot を削除または隔離する。 | runId, setting |
| MCP allowed root が誤っている | `.bob/mcp.json` と env を修正し、MCP server を再起動する。 | allowed root, cwd |
| Bazaar alias で結果が壊れた | `bzr --no-aliases` の実行ログを確認し、alias 直呼び箇所を修正する。 | command log |

## 6. Review Gate

リリース前レビューでは次を確認する。

| Gate | ok 条件 |
|---|---|
| command | command ID allowlist / denylist の test がある。 |
| path | absolute path、`..`、symlink escape、kind mismatch の test がある。 |
| cwd | MCP / VCS 操作 cwd が workspace root に収まる。 |
| revision | Git/Bazaar revision option injection が拒否される。 |
| privacy | generated artifacts の ignore と注意書きがある。 |
| packaging | VSIX に不要な source/test/secret が入っていない。 |
