# 整合プレレビュー MVP 実装計画

## 1. 目的

この文書は、コード変更と要求・設計・テスト文書の整合プレレビューを、最小構成で動かすための実装計画を定義する。

前フェーズで定義した以下の仕様を、実装タスクに落とし込む。

- `review-input-schema.md`
- `review-package-spec.md`
- `document-extraction-spec.md`
- `c-cpp-analysis-scope.md`
- `bob-prompt-template.md`
- `bob-output-schema.md`
- `human-triage-spec.md`

## 2. MVP の到達点

MVP では、1 件の変更に対して以下を一通り実行できる状態を目指す。

```text
review-input.yaml
  ↓
preprocess コマンド
  ↓
review-package 生成
  ↓
bob 投入用 bob-input.md 生成
  ↓
bob-output.yaml 保存
  ↓
validate / triage コマンド
  ↓
accepted-findings.md / questions-to-author.md 生成
```

MVP では、完全な自動レビューや完全な影響範囲解析は目指さない。人間が最終確認する前のプレレビューに必要な根拠パッケージを作れることを優先する。

## 3. 実装対象の拡張機能

### 3.1 review-input-validator

`review-input.yaml` の構文と必須項目を検証する。

主な責務:

- YAML 読み込み
- スキーマバージョン確認
- 必須項目確認
- base/head の指定確認
- 文書パス存在確認
- review_focus の値確認
- エラー / 警告の出力

### 3.2 git-diff-collector

レビュー対象コミット範囲の差分を収集する。

主な責務:

- base/head 解決
- 変更ファイル一覧作成
- ファイルごとの追加・削除行数取得
- rename / delete / add / modify の分類
- unified diff 取得
- changed-files.json 生成

### 3.3 c-cpp-change-analyzer

C/C++ の変更箇所から、関数やシンボルを抽出する。

主な責務:

- C/C++ ファイル判定
- 変更行が属する関数の推定
- 関数定義、構造体、enum、typedef、define の抽出
- グローバル変数候補の抽出
- 直接呼び出し候補の抽出
- RT 禁止処理候補の検出
- changed-symbols.json 生成

### 3.4 document-extractor

要求書・設計書・テスト仕様書・台帳を抽出する。

主な責務:

- `.docx` 抽出
- `.xlsx` 抽出
- `.md` 抽出
- 文書メタデータ取得
- ID 抽出
- evidence_id 付与
- document-index.json 生成
- document-excerpts.md 生成

### 3.5 traceability-builder

要求・設計・コード・テストの対応候補を作成する。

主な責務:

- 明示 ID による対応付け
- 文書 ID とコードシンボルのキーワード対応候補作成
- 台帳 ID とコード要素の対応候補作成
- confidence 付与
- traceability-map.md 生成

### 3.6 review-package-builder

bob 投入用の `review-package` を作成する。

主な責務:

- manifest.yaml 生成
- input-normalized.json 生成
- change-summary.md 生成
- deterministic-checks.md 生成
- diff-context.md 生成
- bob-input.md 生成
- prompts 配置

### 3.7 bob-output-validator

bob の YAML 出力を検証する。

主な責務:

- YAML 構文チェック
- bob-output-schema 検証
- `final_approval: not_performed` 確認
- finding の evidence 必須確認
- evidence_id 存在確認
- バリデーション結果の出力

### 3.8 human-triage-helper

人間が bob 出力を採用・棄却・追加調査に分類できるようにする。

主な責務:

- bob-output.yaml 読み込み
- triage-result.yaml 生成
- accepted-findings.md 生成
- questions-to-author.md 生成
- rejected-findings.md 生成
- follow-up-actions.md 生成

## 4. 実装順序

```text
M1. review-input-validator
M2. git-diff-collector
M3. review-package-builder の最小版
M4. document-extractor の最小版
M5. c-cpp-change-analyzer の最小版
M6. traceability-builder の最小版
M7. bob-input.md 生成
M8. bob-output-validator
M9. human-triage-helper
M10. サンプル変更で end-to-end 検証
```

## 5. マイルストーン

### M1: review-input-validator

#### 目的

人間が指定した `review-input.yaml` を、後続処理に渡せる状態にする。

#### タスク

- [ ] YAML 読み込み処理を作る。
- [ ] 必須項目チェックを作る。
- [ ] `change_type` の enum チェックを作る。
- [ ] `review_focus` の enum チェックを作る。
- [ ] 文書パス存在チェックを作る。
- [ ] warning / error の出力形式を決める。
- [ ] `input-normalized.json` の初期版を生成する。

#### 受け入れ条件

- 正常な `review-input.yaml` を読み込める。
- 必須項目不足を error にできる。
- 文書版数不明などを warning にできる。
- `input-normalized.json` を生成できる。

### M2: git-diff-collector

#### 目的

レビュー対象差分を機械的に確定する。

#### タスク

- [ ] base/head の解決処理を作る。
- [ ] `git diff --name-status` 相当の結果を取得する。
- [ ] 変更ファイルごとの追加・削除行数を取得する。
- [ ] unified diff を取得する。
- [ ] `changed-files.json` を生成する。
- [ ] `diff-context.md` の初期版を生成する。

#### 受け入れ条件

- base/head を指定して変更ファイル一覧を出力できる。
- 追加、変更、削除、rename を分類できる。
- unified diff を保存できる。

### M3: review-package-builder 最小版

#### 目的

bob 投入に必要なディレクトリと基本ファイルを生成する。

#### タスク

- [ ] `.bob-review/review-package/` を作成する。
- [ ] `manifest.yaml` を生成する。
- [ ] `change-summary.md` を生成する。
- [ ] `deterministic-checks.md` の空テンプレートを生成する。
- [ ] `prompts/system.md`、`prompts/task.md`、`prompts/output-format.md` を配置する。
- [ ] `bob-input.md` を生成する。

#### 受け入れ条件

- `review-input.yaml` と Git 差分から review-package を生成できる。
- `bob-input.md` に変更サマリと差分が含まれる。
- 生成物を削除して再実行しても同じ構成で作られる。

### M4: document-extractor 最小版

#### 目的

関連文書の抜粋を review-package に入れる。

#### タスク

- [ ] Markdown 抽出を作る。
- [ ] `.docx` の見出し・段落・表抽出を作る。
- [ ] `.xlsx` のシート・表・行抽出を作る。
- [ ] 要求 ID / 設計 ID / テスト ID 抽出を作る。
- [ ] evidence_id 採番を作る。
- [ ] `document-index.json` を生成する。
- [ ] `document-excerpts.md` を生成する。

#### 受け入れ条件

- 指定された文書から関連抜粋を生成できる。
- evidence_id が重複しない。
- 文書パス、版数、セクション ID が抜粋に残る。

### M5: c-cpp-change-analyzer 最小版

#### 目的

変更された C/C++ コード要素を bob に渡せる形にする。

#### タスク

- [ ] C/C++ ファイル判定を作る。
- [ ] 変更行の関数所属推定を作る。
- [ ] 関数定義抽出を作る。
- [ ] define / enum / struct / typedef 抽出を作る。
- [ ] グローバル変数アクセス候補抽出を作る。
- [ ] 直接呼び出し候補抽出を作る。
- [ ] RT 禁止処理候補のルールチェックを作る。
- [ ] `changed-symbols.json` を生成する。

#### 受け入れ条件

- 変更行が属する関数を一覧化できる。
- 変更された定数・型・構造体を候補として出せる。
- RT 禁止処理候補を warning として出せる。

### M6: traceability-builder 最小版

#### 目的

要求・設計・コード・テストの対応候補を作る。

#### タスク

- [ ] 文書 ID 同士の明示対応を抽出する。
- [ ] 文書 ID とコードシンボル名の候補対応を作る。
- [ ] テストケース ID と要求 / 設計 ID の候補対応を作る。
- [ ] link_type を付与する。
- [ ] confidence を付与する。
- [ ] `traceability-map.md` を生成する。

#### 受け入れ条件

- 明示 ID がある場合に high confidence の対応が作れる。
- キーワード一致のみの場合は low または medium にできる。
- 未対応項目を unknown として残せる。

### M7: bob-input.md 生成

#### 目的

bob に渡す入力を標準化する。

#### タスク

- [ ] system/task/output-format プロンプトを結合する。
- [ ] change-summary を入れる。
- [ ] deterministic-checks を入れる。
- [ ] document-excerpts を入れる。
- [ ] diff-context を入れる。
- [ ] traceability-map を入れる。
- [ ] 入力が大きい場合の分割方針を実装する。

#### 受け入れ条件

- bob-input.md 単体でプレレビューに必要な情報が読める。
- bob の禁止事項が明記されている。
- 出力形式 YAML が明記されている。

### M8: bob-output-validator

#### 目的

bob 出力を人間 triage に渡す前に検証する。

#### タスク

- [ ] YAML パースを作る。
- [ ] 必須トップレベルキーを検証する。
- [ ] finding の必須項目を検証する。
- [ ] evidence_id の存在を検証する。
- [ ] `final_approval: not_performed` を検証する。
- [ ] validation-report.md を生成する。

#### 受け入れ条件

- 正常な bob-output.yaml を通せる。
- YAML 外の本文や必須項目不足を error にできる。
- 存在しない evidence_id を warning または error にできる。

### M9: human-triage-helper

#### 目的

bob 出力を正式レビューに渡せる形に変換する。

#### タスク

- [ ] bob-output.yaml を一覧化する。
- [ ] triage-result.yaml のテンプレートを生成する。
- [ ] accept / reject / investigate / ask_author の decision を記録できるようにする。
- [ ] accepted-findings.md を生成する。
- [ ] questions-to-author.md を生成する。
- [ ] rejected-findings.md を生成する。
- [ ] follow-up-actions.md を生成する。

#### 受け入れ条件

- すべての finding / question に triage decision を記録できる。
- 採用した指摘を正式レビュー向け Markdown にできる。
- 棄却理由を残せる。

### M10: end-to-end 検証

#### 目的

サンプル変更で一連の流れを確認する。

#### タスク

- [ ] 小さな C コード差分のサンプルを用意する。
- [ ] 要求書サンプルを用意する。
- [ ] 詳細設計書サンプルを用意する。
- [ ] テスト仕様書サンプルを用意する。
- [ ] review-input.yaml を用意する。
- [ ] preprocess を実行する。
- [ ] bob-input.md を確認する。
- [ ] bob-output.yaml のサンプルを作る。
- [ ] validate / triage を実行する。
- [ ] 生成物一式を確認する。

#### 受け入れ条件

- `review-input.yaml` から `accepted-findings.md` まで通る。
- 生成物に対象コミット、文書版数、evidence_id が残る。
- bob が最終承認していないことを確認できる。

## 6. CLI コマンド案

### 6.1 preprocess

```bash
bob-review preprocess \
  --input review-input.yaml \
  --out .bob-review/review-package
```

実行内容:

- review-input 検証
- Git diff 収集
- 文書抽出
- C/C++ 解析
- traceability-map 作成
- bob-input.md 生成

### 6.2 validate-output

```bash
bob-review validate-output \
  --package .bob-review/review-package \
  --bob-output .bob-review/bob-output/bob-output.yaml
```

実行内容:

- bob-output.yaml のスキーマ検証
- evidence_id 検証
- validation-report.md 生成

### 6.3 triage

```bash
bob-review triage \
  --package .bob-review/review-package \
  --bob-output .bob-review/bob-output/bob-output.yaml \
  --out .bob-review/human-triage
```

実行内容:

- triage-result.yaml テンプレート生成
- accepted-findings.md 生成
- questions-to-author.md 生成
- rejected-findings.md 生成

## 7. 実装時の優先順位

| 優先度 | 対象 | 理由 |
|---|---|---|
| P0 | review-input-validator | 入力が不安定だと全工程が崩れる |
| P0 | git-diff-collector | レビュー対象の確定が最重要 |
| P0 | review-package-builder | bob に渡す形を先に固定する |
| P1 | document-extractor | 整合レビューの根拠になる |
| P1 | bob-prompt / bob-input 生成 | bob の役割逸脱を防ぐ |
| P1 | bob-output-validator | 後処理の安定化に必要 |
| P2 | c-cpp-change-analyzer | MVP では簡易版から開始 |
| P2 | traceability-builder | 最初は明示 ID 中心でよい |
| P2 | human-triage-helper | 最初は YAML / Markdown ベースでよい |

## 8. MVP でやらないこと

- GUI の実装
- PR への自動コメント投稿
- Redmine 連携
- PDF 抽出
- `.doc` / `.xls` の直接対応
- 完全な C/C++ AST 解析
- 関数ポインタ経由の完全追跡
- 全要求・全テストの網羅保証
- bob の自動実行基盤
- 自動承認または自動マージ

## 9. リスクと対策

| リスク | 内容 | 対策 |
|---|---|---|
| 入力文書が古い | bob が古い仕様に引きずられる | 文書版数 unknown を warning にする |
| 差分が大きすぎる | bob-input が肥大化する | 分割投入ルールを用意する |
| C 解析の誤検出 | マクロや関数ポインタで誤る | confirmed / candidate / unknown を分ける |
| bob の断定 | 最終承認のような出力になる | prompt と output schema で禁止する |
| evidence 不整合 | 存在しない根拠を参照する | bob-output-validator で検出する |
| triage 放置 | 指摘候補が正式レビューに繋がらない | triage 完了条件を設ける |

## 10. 最初の実装チケット候補

```text
MVP-001 review-input.yaml の読み込みと検証
MVP-002 changed-files.json の生成
MVP-003 review-package の基本ディレクトリ生成
MVP-004 bob-input.md の最小生成
MVP-005 Markdown 文書抽出
MVP-006 docx 文書抽出
MVP-007 xlsx 文書抽出
MVP-008 変更関数の簡易抽出
MVP-009 traceability-map.md の最小生成
MVP-010 bob-output.yaml の検証
MVP-011 triage-result.yaml テンプレート生成
MVP-012 サンプル end-to-end 検証
```

## 11. 完了判定

MVP 実装フェーズは、以下を満たしたら完了とする。

- `bob-review preprocess` が実行できる。
- review-package の必須ファイルが生成される。
- bob-input.md が生成される。
- bob-output.yaml をスキーマ検証できる。
- triage-result.yaml を生成できる。
- サンプル変更で end-to-end の成果物が確認できる。
- bob が最終承認・網羅保証を行わない運用になっている。
