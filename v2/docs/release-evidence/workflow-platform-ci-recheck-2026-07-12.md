# Workflow Platform CI 再確認証跡

## 1. 目的

`docs/superpowers/plans/2026-07-12-workflow-platform-remediation-continuation.md` の Phase 0 完了後に残った外部リリースゲートについて、GitHub-hosted runner が復旧しているかを再確認した。

| 項目 | 値 |
| --- | --- |
| 実施日 | 2026-07-12 |
| Repository | `katamor1/bob_builtin_analyze` |
| 再実行対象 head | `8626df1acb1d72a6afb6d149cf15bf2144f0ce52`（PR #68 head） |
| 最新 `main`（確認開始時） | `e78fb4f8ab7f2747776097d09a2262638f1840a8` |
| 判定 | **BLOCKED — runner step 開始前に失敗** |
| 製品リリース | **NO-GO** |

Phase 0 のローカル実装・回帰テスト・package/policy gate は既存証跡どおり完了している。本書は、その結果を GitHub Actions の green と読み替えるものではない。

## 2. 再実行した workflow

GitHub API から、PR #68 head に紐づく失敗 workflow の failed jobs 再実行を要求した。3 workflow とも再実行要求自体は受理された。

| Workflow | Run ID | 再実行後の結果 |
| --- | ---: | --- |
| `extensions-quality` | `29153144606` | 7 job すべて `completed / failure` |
| `workflow-contracts` | `29153144643` | 1 job が `completed / failure` |
| `code-consistency-review-scaffold` | `29153144613` | 2 job すべて `completed / failure` |

## 3. 再実行 attempt の観測値

### 3.1 `extensions-quality`

再実行後の job ID は次のとおり。

- `86621239410` — `workflow-register`
- `86621239411` — `bob-bazaar-review`
- `86621239414` — `bob-code-consistency-review`
- `86621239416` — `Windows / bob-bazaar-review`
- `86621239427` — `Windows / bob-code-consistency-review`
- `86621239428` — `Windows / workflow-register`
- `86621239431` — `Extension source metrics`

全 job が `steps: null`、`logs_url: null` のまま終了した。checkout、Node.js setup、`npm`、repository script のいずれも開始した証拠がない。

### 3.2 `workflow-contracts`

- `86621245199` — `Strict workflow validation`

この job も `steps: null`、`logs_url: null` のまま `completed / failure` となった。

### 3.3 `code-consistency-review-scaffold`

- `86621249145` — `Validate scaffold`
- `86621249154` — `Validate VS Code extension`

両 job とも `steps: null`、`logs_url: null` のまま `completed / failure` となった。

## 4. 判定

今回の再実行でも runner step は一つも開始されなかった。したがって、失敗原因を repository code、test、package、workflow YAML の実行結果へ帰属させることはできない。

観測結果は、既存証跡で記録された GitHub-hosted runner 割当、private repository Actions 利用枠、spending limit、billing、または runner 許可設定側の blocker と同型である。原因の特定には GitHub repository / organization の Actions 利用設定と課金状態の確認が必要である。

次の項目は未完了のまま維持する。

1. Ubuntu / Windows matrix の runner step 開始からの green。
2. 実 VS Code Extension Host activation smoke。
3. IBM Bob 2.0.1 実機 UAT。
4. 実 Bazaar timeout / cancel / path / encoding UAT。
5. multi-root / workspace alias の実 GUI UAT。
6. 配布署名、配布経路、rollback 手順。

## 5. Phase 1 handoff

外部 runner blocker と独立して進められる次のコードローカル課題は、既存 rebaseline の次の二点である。

1. workflow package の明示的な schema version negotiation。現在の parser は `schemaVersion === "workflow-register/v1"` の場合だけ v1 parser を選び、それ以外を legacy parser へ送るため、未知・typo・将来 version を fail closed にする境界が必要である。
2. `run.json` 自身の schema version、decoder、migration chain、unknown-newer read-only 保護、historical fixtures。

実装順は、入力契約の誤解釈を先に防ぐ schema version negotiation、その後に永続 run-state migration とする。いずれも v1 workflow compatibility を維持し、focused RED、migration/golden fixtures、compile、full test、policy、package gate を必須とする。

## 6. 次回確認

本証跡だけを変更する draft PR は、3 workflow の `pull_request.paths` に一致しないため、新しい run を自動生成しない。runner 状態を確認するためだけの無意味な workflow / source 変更は追加しない。

repository / organization 側の Actions 利用設定と課金状態を確認した後、最新 `main` または実コード変更を含む Phase 1 branch に対して、次の workflow を `workflow_dispatch` で実行する。

1. `extensions-quality`
2. `workflow-contracts`
3. `code-consistency-review-scaffold`

各 run について runner step、job logs、Ubuntu / Windows の結果を新しい run ID とともに記録する。再び `steps: null` の場合は外部 blocker 継続として扱い、repository code の修正で green 化を試みない。
