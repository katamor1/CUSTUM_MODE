# 整合プレレビュー MVP 実装スケルトン

## 1. 目的

このディレクトリは、整合プレレビュー MVP を実装するときのスケルトンである。

既存拡張機能の配置やビルド方式と衝突しないよう、まずは `docs/workflows/code-consistency-review/scaffold/` 配下に、実装開始用の構成案と最小コード骨格を置く。

後続フェーズで既存リポジトリ構成に合わせて、`extensions/` などの実装配置へ移す。

## 2. 想定コマンド

```bash
bob-review preprocess --input review-input.yaml --out .bob-review/review-package
bob-review validate-output --package .bob-review/review-package --bob-output .bob-review/bob-output/bob-output.yaml
bob-review triage --package .bob-review/review-package --bob-output .bob-review/bob-output/bob-output.yaml --out .bob-review/human-triage
```

## 3. スケルトン構成

```text
scaffold/
  README.md
  package.json
  tsconfig.json
  src/
    cli/
      main.ts
      commands/
        preprocess.ts
        validate-output.ts
        triage.ts
    core/
      result.ts
      file-system.ts
      review-input-validator.ts
      git-diff-collector.ts
      review-package-builder.ts
      bob-output-validator.ts
    analyzers/
      document-extractor.ts
      c-cpp-change-analyzer.ts
      traceability-builder.ts
    triage/
      human-triage-helper.ts
    templates/
      template-loader.ts
```

## 4. MVP で実装する順序

1. `main.ts` でサブコマンドを振り分ける。
2. `review-input-validator.ts` で `review-input.yaml` を読む。
3. `git-diff-collector.ts` で changed-files を作る。
4. `review-package-builder.ts` で review-package の最低限を作る。
5. `template-loader.ts` で prompt template を読む。
6. `bob-output-validator.ts` で bob-output.yaml を検証する。
7. `human-triage-helper.ts` で triage-result.yaml を作る。
8. サンプル `simple-timeout-bugfix` で E2E を通す。

## 5. このスケルトンでまだやらないこと

- 既存拡張機能への組み込み
- GUI
- GitHub PR コメント投稿
- Redmine 連携
- Word / Excel の完全抽出
- clang AST 解析
- bob 自動実行

## 6. 実装時の注意

- `schemas/` と `templates/` は `docs/workflows/code-consistency-review/` 側の実装アセットを参照する。
- bob に渡す内容には evidence_id を必ず残す。
- bob-output の `final_approval` は `not_performed` 以外を invalid とする。
- 解析不能なものを黙って捨てず、warning として保存する。
