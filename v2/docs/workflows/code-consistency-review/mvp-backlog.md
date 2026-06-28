# 整合プレレビュー MVP バックログ

## 1. 目的

このバックログは、整合プレレビュー MVP を実装するための最初の作業単位を定義する。

`mvp-implementation-plan.md` のマイルストーンを、実装チケットとして扱いやすい粒度に分解する。

## 2. バックログ方針

- 最初は CLI とファイル生成を優先する。
- GUI、PR コメント、Redmine 連携は後続に回す。
- bob の実行自体は MVP では外部手順でもよい。
- bob の出力を保存・検証・triage できることを重視する。
- C/C++ 解析は簡易版から始め、解析不能は warning として残す。

## 3. Epic 一覧

| Epic | 内容 |
|---|---|
| EPIC-01 | CLI 基盤 |
| EPIC-02 | review-input 検証 |
| EPIC-03 | Git 差分収集 |
| EPIC-04 | review-package 生成 |
| EPIC-05 | 文書抽出 |
| EPIC-06 | C/C++ 変更解析 |
| EPIC-07 | トレーサビリティ候補生成 |
| EPIC-08 | bob 入力・出力検証 |
| EPIC-09 | 人間 triage |
| EPIC-10 | E2E サンプル検証 |

## 4. EPIC-01 CLI 基盤

### MVP-001 bob-review CLI のエントリポイントを作る

目的:

- `bob-review` コマンドを実行できるようにする。

作業:

- [ ] CLI のエントリポイントを作る。
- [ ] `preprocess`、`validate-output`、`triage` のサブコマンドを定義する。
- [ ] `--help` を出せるようにする。
- [ ] 終了コード方針を決める。

受け入れ条件:

- `bob-review --help` が動く。
- 未実装サブコマンドは明確なメッセージで終了する。

### MVP-002 共通ログ・エラー出力を作る

目的:

- warning / error を後工程で読める形式にそろえる。

作業:

- [ ] 標準出力と標準エラーの使い分けを決める。
- [ ] JSON または Markdown の report 出力形式を決める。
- [ ] エラーコード一覧を作る。

受け入れ条件:

- 入力エラー時に、何を直すべきか分かるメッセージが出る。

## 5. EPIC-02 review-input 検証

### MVP-010 review-input.yaml を読み込む

目的:

- 人間が書いたレビュー入力を読み込む。

作業:

- [ ] YAML パーサを組み込む。
- [ ] `schema_version` を確認する。
- [ ] `review` と `artifacts` を読み込む。

受け入れ条件:

- `examples/simple-timeout-bugfix/review-input.yaml` を読み込める。

### MVP-011 review-input の必須項目を検証する

作業:

- [ ] `review.id` を必須にする。
- [ ] `review.title` を必須にする。
- [ ] `review.change_type` を必須にする。
- [ ] `review.base` / `review.head` を必須にする。
- [ ] `artifacts` が空の場合は error にする。

受け入れ条件:

- 必須項目不足を error として検出できる。

### MVP-012 review-input を正規化する

作業:

- [ ] 既定値を補完する。
- [ ] 文書リストを内部形式に正規化する。
- [ ] `input-normalized.json` を生成する。

受け入れ条件:

- review-package に `input-normalized.json` が生成される。

## 6. EPIC-03 Git 差分収集

### MVP-020 base/head を解決する

作業:

- [ ] base ref の存在を確認する。
- [ ] head ref の存在を確認する。
- [ ] base sha / head sha を取得する。

受け入れ条件:

- `manifest.yaml` に base sha / head sha を保存できる。

### MVP-021 changed-files.json を生成する

作業:

- [ ] 変更ファイル一覧を取得する。
- [ ] status を分類する。
- [ ] additions / deletions を取得する。
- [ ] C/C++ ファイルかどうかを判定する。

受け入れ条件:

- `changed-files.json` が生成される。

### MVP-022 diff-context.md を生成する

作業:

- [ ] unified diff を保存する。
- [ ] ファイルごとに章立てする。
- [ ] 差分が大きい場合は warning を出す。

受け入れ条件:

- bob-input.md に取り込める Markdown 形式になる。

## 7. EPIC-04 review-package 生成

### MVP-030 review-package ディレクトリを作る

作業:

- [ ] `.bob-review/review-package/` を作る。
- [ ] 既存出力がある場合の上書き方針を決める。
- [ ] 生成日時を保存する。

受け入れ条件:

- preprocess 実行で review-package の基本構成が作られる。

### MVP-031 manifest.yaml を生成する

作業:

- [ ] package_version を保存する。
- [ ] repository 情報を保存する。
- [ ] review 情報を保存する。
- [ ] prompt template 情報を保存する。

受け入れ条件:

- 後から同じ入力条件を追跡できる。

### MVP-032 change-summary.md を生成する

作業:

- [ ] 変更目的を入れる。
- [ ] 変更ファイル一覧を要約する。
- [ ] 変更関数一覧があれば入れる。
- [ ] warning を入れる。

受け入れ条件:

- 人間が読んで変更概要を把握できる。

## 8. EPIC-05 文書抽出

### MVP-040 Markdown 文書抽出

作業:

- [ ] 見出し単位で chunk 化する。
- [ ] Markdown 表を保持する。
- [ ] ID を抽出する。
- [ ] evidence_id を付ける。

受け入れ条件:

- サンプル要求書 Markdown から `REQ-123` を抽出できる。

### MVP-041 docx 文書抽出

作業:

- [ ] 見出しを抽出する。
- [ ] 段落を抽出する。
- [ ] 表を抽出する。
- [ ] 版数候補を抽出する。

受け入れ条件:

- docx サンプルを document-excerpts.md に変換できる。

### MVP-042 xlsx 文書抽出

作業:

- [ ] シート名を抽出する。
- [ ] 使用範囲を抽出する。
- [ ] 行単位に JSON 化する。
- [ ] ID 列候補を抽出する。

受け入れ条件:

- xlsx サンプルから `DD-88` と `TC-789` を抽出できる。

## 9. EPIC-06 C/C++ 変更解析

### MVP-050 変更行の関数所属を推定する

作業:

- [ ] C/C++ ファイルを対象にする。
- [ ] 関数定義の範囲を簡易推定する。
- [ ] 変更行を関数に紐付ける。

受け入れ条件:

- `Foo_HandleTimeout` の変更を `changed-symbols.json` に出せる。

### MVP-051 define / enum / struct / typedef の変更候補を抽出する

作業:

- [ ] 変更行周辺の define を検出する。
- [ ] struct / enum / typedef の変更候補を検出する。
- [ ] confidence を付与する。

受け入れ条件:

- 型・定数変更が candidate として出る。

### MVP-052 RT 禁止処理候補を検出する

作業:

- [ ] 禁止 API 名リストを作る。
- [ ] 変更行または変更関数内の禁止 API 呼び出しを検出する。
- [ ] warning を出す。

受け入れ条件:

- `fopen`、`malloc`、`Sleep` などの候補を検出できる。

## 10. EPIC-07 トレーサビリティ候補生成

### MVP-060 明示 ID で対応付ける

作業:

- [ ] 要求 ID と設計 ID の同一文脈出現を拾う。
- [ ] 設計 ID とテスト ID の同一文脈出現を拾う。
- [ ] confidence high を付与する。

受け入れ条件:

- `REQ-123 -> DD-88 -> TC-789` の候補を作れる。

### MVP-061 コードシンボルとの候補対応を作る

作業:

- [ ] 関数名と文書内キーワードを照合する。
- [ ] エラーコード名を照合する。
- [ ] link_type を設定する。

受け入れ条件:

- `Foo_HandleTimeout` と timeout 関連文書を候補対応できる。

## 11. EPIC-08 bob 入力・出力検証

### MVP-070 bob-input.md を生成する

作業:

- [ ] prompt template を結合する。
- [ ] change-summary を結合する。
- [ ] document-excerpts を結合する。
- [ ] diff-context を結合する。
- [ ] traceability-map を結合する。

受け入れ条件:

- bob-input.md が単体で読める。

### MVP-071 bob-output.yaml を検証する

作業:

- [ ] YAML として解析する。
- [ ] 必須トップレベルキーを検証する。
- [ ] evidence_id を照合する。
- [ ] `final_approval: not_performed` を確認する。

受け入れ条件:

- サンプル bob-output.yaml を valid にできる。
- 不正な final_approval を error にできる。

## 12. EPIC-09 人間 triage

### MVP-080 triage-result.yaml テンプレートを生成する

作業:

- [ ] findings を items に展開する。
- [ ] questions を items に展開する。
- [ ] decision 未設定のテンプレートを作る。

受け入れ条件:

- 人間が YAML を編集して decision を記録できる。

### MVP-081 triage Markdown を生成する

作業:

- [ ] accepted-findings.md を生成する。
- [ ] questions-to-author.md を生成する。
- [ ] rejected-findings.md を生成する。
- [ ] follow-up-actions.md を生成する。

受け入れ条件:

- triage-result.yaml の decision に応じて Markdown を分割生成できる。

## 13. EPIC-10 E2E サンプル検証

### MVP-090 simple-timeout-bugfix サンプルを作る

作業:

- [ ] サンプル C ファイルを作る。
- [ ] サンプル要求書を作る。
- [ ] サンプル詳細設計を作る。
- [ ] サンプルテスト仕様を作る。
- [ ] review-input.yaml を作る。

受け入れ条件:

- preprocess の入力として使えるサンプルが揃う。

### MVP-091 E2E 手順書を作る

作業:

- [ ] preprocess 手順を書く。
- [ ] bob-input.md 確認手順を書く。
- [ ] bob-output.yaml サンプル適用手順を書く。
- [ ] validate-output 手順を書く。
- [ ] triage 手順を書く。

受け入れ条件:

- 初見の実装者がサンプルで一連の流れを確認できる。

## 14. 着手順の推奨

最初の着手順は以下とする。

```text
1. MVP-001 CLI エントリポイント
2. MVP-010 review-input.yaml 読み込み
3. MVP-011 review-input 必須項目検証
4. MVP-020 base/head 解決
5. MVP-021 changed-files.json 生成
6. MVP-030 review-package ディレクトリ生成
7. MVP-031 manifest.yaml 生成
8. MVP-070 bob-input.md 生成
9. MVP-071 bob-output.yaml 検証
10. MVP-080 triage-result.yaml テンプレート生成
```

この順序なら、文書抽出や C/C++ 解析が簡易版でも、先に全体のパイプラインを通せる。
