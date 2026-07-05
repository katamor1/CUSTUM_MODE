# Rollout Guide

## 目的

Phase 3 workflow を main の作業ツリーから分離し、sandbox で見える化と smoke を確認してから実運用へ進めます。

## 手順

1. `npm.cmd test` を `extensions/workflow-register`、`extensions/bob-code-consistency-review`、`extensions/bob-bazaar-review` で通します。
2. `extensions/workflow-register` で `npm.cmd run package` と `npm.cmd run package:policy` を通します。
3. `docs/workflows/process-workflows/integration/launch-process-workflows-sandbox.ps1 -NoLaunch` を実行し、14 workflow と `.bob/process` が sandbox workspace にコピーされることを確認します。
4. 実機で launcher を `-NoLaunch` なしで実行し、Bob Workflow Runs から少なくとも 6 workflow を順に smoke します。
5. `.bob-process-runs/` と `.bob-process-records/` の生成物を確認し、不要な生成物を commit しません。

## 戻し方

workflow 定義は `.bob/workflows/process-*` に閉じています。問題があれば対象 workflow の folder を削除または前の commit へ戻し、生成済み `.bob-process-*` は作業 workspace から削除します。
