# Phase 4 Template Customization GUI Core UAT

## 目的

v1 GUI Core の UAT は、Template Customization Studio から標準テンプレート選択、profile/customization の安全編集、workflow 生成、readiness report 確認までを実施できることを確認する。

## Sandbox 準備

1. 対象 workspace に `.bob/template-library/standard/process-code-precheck/metadata.yaml` と `WORKFLOW.md` があることを確認する。
2. `.bob/process/process-catalog.yaml` を配置する。
3. checklist を配置する。
   - 例: `.bob/process/checklists/alpha-code-precheck.yaml`
4. UAT evidence を配置する。
   - 例: `docs/uat/evidence/alpha-product.md`
5. Bazaar workspace の場合、UAT 手順と profile の両方で `bzr --no-aliases` を明記する。

## 基本操作

1. Command Palette から `Bob Workflow: テンプレートカスタマイズ Studio` を開く。
2. `Template Library` で `process-code-precheck` を選ぶ。
3. `Customize` で次を入力する。
   - projectId: `alpha-product`
   - targetLanguage: `c_cpp`
   - vcs.type: `bazaar`
   - checklist path: `.bob/process/checklists/alpha-code-precheck.yaml`
   - workflowName: `alpha-code-precheck`
   - prompt supplement: `Bazaar 操作では bzr --no-aliases を使う。`
4. `profile を検証` と `customization を検証` を実行する。
5. `preview` を実行し、生成予定 `WORKFLOW.md` に `x-bob-template` が含まれることを確認する。
6. 既存 workflow がある場合は `diff` を開く。
7. `workflow を生成` を実行する。
8. `Readiness` で `readiness check` を実行し、report を開く。

## UAT ケース

| ID | 操作 | 期待結果 |
| --- | --- | --- |
| P4-GUI-UAT-001 | Studio を開く。 | 3 タブ `Template Library`、`Customize`、`Readiness` が表示される。 |
| P4-GUI-UAT-002 | Library を確認する。 | tracked standard template `process-code-precheck` が既定選択される。 |
| P4-GUI-UAT-003 | Bazaar profile を検証する。 | `vcs.noAliases: true` 前提で profile が valid。UI 文言に `bzr --no-aliases` が残る。 |
| P4-GUI-UAT-004 | unsafe path を入力して preview する。 | diagnostics に workspace escape が表示され、workflow は生成されない。 |
| P4-GUI-UAT-005 | valid input で preview する。 | 生成予定 Markdown が既存 workflow validator を通り、`x-bob-template` を持つ。 |
| P4-GUI-UAT-006 | workflow を生成する。 | profile、customization、workflow が `.bob/` 配下の所定パスに保存される。 |
| P4-GUI-UAT-007 | checklist を消して readiness を実行する。 | `status: fail`、`required-files` の nextActions が表示される。 |
| P4-GUI-UAT-008 | UAT evidence を消して readiness を実行する。 | `status: warning`、UAT evidence の nextActions が表示される。 |
| P4-GUI-UAT-009 | checklist と UAT evidence を戻して readiness を実行する。 | `status: pass`、JSON/Markdown report が `.bob/template-readiness/alpha-product/` に保存される。 |

## 合格条件

- Studio から生成した workflow が `.bob/workflows/<workflowName>/WORKFLOW.md` に保存される。
- profile/customization は GUI 管理パスに保存される。
- readiness UI で status、score、checks、nextActions を追跡できる。
- readiness JSON/Markdown report を開ける。
- guardrails、command provider、result sink type を編集する UI が存在しない。
