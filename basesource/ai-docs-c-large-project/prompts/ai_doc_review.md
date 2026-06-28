# Prompt: AI生成ドキュメントレビュー

以下のAI生成ドキュメントをレビューしてください。

## 判定

- PASS: そのまま採用可能
- REVISE: 修正すれば採用可能
- BLOCK: 誤り・危険・根拠不足で不採用

## チェック項目

- ソース根拠があるか
- 推定を断言していないか
- DLL名・関数名・構造体名を取り違えていないか
- 共有メモリの読み書き方向が正しいか
- 初期化・終了・異常時の扱いを誤っていないか
- テスト観点として使える粒度か
- 古いコメントを事実として扱っていないか

## 出力

```md
# Review Result

## Decision
PASS / REVISE / BLOCK

## Findings

## Required Fixes

## Accepted Scope

## Rejected Scope

## Follow-up Issues
```
