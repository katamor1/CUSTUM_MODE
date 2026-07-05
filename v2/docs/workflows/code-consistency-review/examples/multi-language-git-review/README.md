# multi-language-git-review

Git 差分から TypeScript / Python / Java の汎用コード根拠を生成する Phase 2 サンプル。

この fixture は `main..feature/multi-language-git-review` の実 Git repository を一時作成して使う。
C/C++ の深掘り解析ではなく、diff hunk 単位の `SRC-*` evidence、`changed-files.json` の language、`bob-input.md` の汎用コード変更根拠を確認する。
