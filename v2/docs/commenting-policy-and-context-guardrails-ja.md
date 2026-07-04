# コメント方針とコンテキストガードレール

## 1. 目的

本ドキュメントは、`bob_builtin_analyze` リポジトリにおけるソースコードコメントの方針を定義する。

本プロジェクトでは、主に CODEX が仕様書を読み、実装とレビューを行うスタイルで開発している。そのため、短期的にはコード上のコメントが少なくても開発を進められる。一方で、将来の保守、別 AI による修正、人間による部分レビュー、仕様書をすべて読まない状況では、コード近傍に残る文脈が不足しやすい。

本方針の目的は、コメント量を増やすことではない。仕様書を読まなくても、変更時に壊してはいけない境界・契約・制約・理由が分かる状態を作ることである。

## 2. 前提

- 主要なソースコード読者は日本人である。
- コメント本文は原則として日本語で書く。
- 識別子、型名、API 名、command ID、provider ID、schema field、JSDoc タグは英語または実コード上の表記を維持する。
- 仕様書、設計書、README は引き続き設計意図の主要な保管場所とする。
- コードコメントは仕様書の代替ではなく、コード変更時に見落とすと危険な文脈をコード近傍に置くための安全ピンとして扱う。

## 3. 現状認識

本リポジトリには、workflow、review input、Bob prompt、Bob output、human triage、traceability sidecar、MVP architecture、各拡張の基本設計・詳細設計・テスト仕様など、多くの仕様書が整備されている。

一方で、ソースコード上のコメントは、entry point や public API に JSDoc を追加し始めた段階であり、リポジトリ全体としての統一方針はまだ弱い。

この状態は、次のように評価できる。

| 観点 | 評価 |
| --- | --- |
| 仕様書・設計書 | 充実している |
| モジュール分割 | 進んでいる |
| コードコメント | 入口や一部 public API 中心で、まだ局所的 |
| 主なリスク | 仕様書を読んだ CODEX 前提が強く、将来の保守時に文脈欠落が起きやすい |

## 4. コメント不足によるリスク

### 4.1 CODEX 依存・仕様書読解依存

主の CODEX が仕様書を読んで実装している間は、コード上の説明が少なくても動く。しかし、別の AI、別の保守者、または将来の自分が一部ファイルだけを見て修正する場合、次の情報が失われやすい。

- なぜこの処理が必要なのか。
- どこまで変更してよいのか。
- どの ID や schema が互換性契約なのか。
- 仕様書上の安全境界がコード上のどこに対応しているのか。

### 4.2 安全境界の見落とし

本プロジェクトは、workspace path、VCS revision、外部コマンド、生成物、AI/Bob 出力、traceability catalog などを扱う。これらは、単なる実装詳細ではなく、セキュリティ、機密情報、レビュー結果の信頼性に関係する。

特に次のような箇所は、コードを読んだだけでは意図が伝わりにくい。

- workspace 外 path を許可するか拒否するか。
- workflow args から executable path を上書きしてよいか。
- AI 出力をどこまで正規化してよいか。
- `.bob-review` や `.bob-trace` の生成物に機密情報が含まれる前提をどう扱うか。

### 4.3 中心型・中心モジュールの肥大化

`workflow-register` の中心型、workflow runtime、provider API、result sink API のように、複数の責務が集まる箇所では、コメントまたは型分割がないと変更影響を読み違えやすい。

コメントは肥大化そのものを解決しない。長期的にはファイル分割や依存方向の整理が必要である。ただし、分割までの間は、どの型が file schema 由来で、どの型が runtime metadata で、どの型が外部 provider API なのかを明示するコメントが有効である。

### 4.4 悪いコメントの増加

コメントを一律に増やすと、実装と同期しない説明、関数名の言い換え、仕様書の劣化コピーが増える。これはコメント不足より危険な場合がある。

本方針では、コメント量ではなく、保守上の文脈価値を基準にする。

## 5. 基本方針

コメントは少なめでよい。ただし、保守・安全・互換性の境界にはコメントを義務化する。

言い換えると、次の方針を採用する。

> コメントを書く文化ではなく、文脈を失わない文化にする。

コメントには、次のいずれかを書く。

- なぜそうしているか。
- 何を壊してはいけないか。
- どの入力を信頼してよいか、信頼してはいけないか。
- どの ID、schema、provider 名が互換性契約なのか。
- AI が判断してよい範囲と、人間判断が必要な範囲はどこか。
- 近似、fallback、canonicalize、repair がレビュー信頼性へどう影響するか。

コメントには、次の内容を書かない。

- コードを読めば分かる処理説明。
- 関数名や型名を日本語に言い換えただけの説明。
- 仕様書の長文コピー。
- 実装予定だけを書いた曖昧な TODO。
- テストで表現できる期待値の羅列。

## 6. コメントの言語方針

主な読者が日本人であるため、コメント本文は日本語を原則とする。

ただし、以下は英語または実コード上の表記を維持する。

| 対象 | 方針 |
| --- | --- |
| 関数名・変数名・型名 | 英語のまま |
| `@param`, `@returns`, `@throws` | JSDoc タグとして英語のまま |
| VS Code API / Bob API / Git / Bazaar など | 固有名を維持 |
| command ID / provider ID / schema field | 実データ名を維持 |
| コメント本文 | 日本語 |
| 理由・制約・安全境界の説明 | 日本語 |

例:

```ts
/**
 * Bob コード整合レビュー拡張を有効化し、VS Code command と workflow provider を登録する。
 *
 * command ID と provider ID は既存 workflow から参照される互換性契約である。
 * リファクタ時も ID を変更せず、処理本体だけを下位モジュールへ分離する。
 *
 * @param context command 登録と同梱テンプレート解決に使う VS Code 拡張コンテキスト。
 */
export function activate(context: vscode.ExtensionContext): void {
  // ...
}
```

## 7. コメントを書くべき場所

### 7.1 Public API / exported type / exported function

外部 module、他拡張、workflow provider、test helper から参照される型や関数には、責務と契約を書く。

書くべき内容:

- 何の境界を提供するか。
- 呼び出し元が満たすべき前提。
- 戻り値が後段 workflow でどう扱われるか。
- 互換性維持の制約。

### 7.2 Command entry / provider entry

VS Code command、workflow-register action provider、Bob workflow から呼ばれる入口にはコメントを書く。

特に command ID と provider ID は、既存 workflow との互換性契約である。リファクタ時に処理本体を分離しても、ID を変更してはいけない場合は明記する。

### 7.3 Workspace path boundary

workspace root、review input path、review package path、traceability catalog path、Bob output path、triage path、diff fixture path などを解決する箇所には、安全境界を書く。

書くべき内容:

- workspace 外 path を許可するか拒否するか。
- absolute path を受け付けるか。
- workflow args と user/global config のどちらを信頼するか。
- 外部 path を許可する場合の opt-in 条件。

### 7.4 External command / VCS execution

Git、Bazaar、外部 executable を実行する箇所にはコメントを書く。

書くべき内容:

- shell 経由か argv 経由か。
- revision を事前検証・正規化するか。
- `--no-aliases` など安全のために必須のオプション。
- workflow args から executable path を上書きできるか。

### 7.5 AI output / human approval boundary

AI draft、Bob output、traceability catalog、human triage では、AI と人間の責務境界を書く。

書くべき内容:

- AI が作成してよいのは候補までか。
- `accepted` / `rejected` / `deprecated` などの状態変更を人間に限定するか。
- AI 出力をどこまで canonicalize してよいか。
- raw validation と canonicalized validation を分けるか。

例:

```ts
/**
 * AI 生成の traceability 候補を catalog に取り込む。
 *
 * AI は候補作成までを担当し、accepted / rejected / deprecated への状態変更は行わない。
 * 承認状態の変更権限は Traceability Prep Webview での人間操作に限定する。
 */
```

### 7.6 Webview message boundary

VS Code extension host と Webview client script の message 境界にはコメントを書く。

書くべき内容:

- Webview から受け取る message の信頼レベル。
- validation の責務が host 側か client 側か。
- CSP により inline handler を使わないなどの制約。
- 保存や承認など副作用を host 側で再検証する理由。

### 7.7 Generated artifact / destructive write

backup、overwrite、generated artifact、clipboard、state store、snapshot、result sink など、副作用がある箇所にはコメントを書く。

書くべき内容:

- 既存ファイルを上書きする条件。
- backup を作る理由。
- `.bob-review` / `.bob-trace` に機密情報が含まれる可能性。
- 古い生成物が残る場合の freshness policy。

### 7.8 Fallback / repair / canonicalize

fallback、repair、canonicalize、legacy migration は、意図が誤解されやすいためコメントを書く。

書くべき内容:

- どの互換性を守るための処理か。
- 失敗時に warning と error のどちらにするか。
- 補正しすぎるとレビュー信頼性が落ちる場合の境界。

### 7.9 Lightweight analyzer / approximation

C/C++ 解析、文書抽出、JSON/YAML 抽出など、近似や heuristic を使う箇所にはコメントを書く。

例:

```ts
// この関数検出は軽量な正規表現ベースであり、完全な C/C++ 意味解析ではない。
// 誤検出の可能性があるため、Bob input では evidence 候補として扱い、確定判断は人間レビューに残す。
```

## 8. コメントを書かない場所

次のようなコメントは避ける。

```ts
// name を正規化する
const name = normalizeWorkflowName(model.metadata.name)
```

このコメントはコードを言い換えているだけで、保守上の価値が低い。

代わりに、差分安定性や互換性のために正規化しているなら、その理由を書く。

```ts
// Workflow ID は run state と artifact path に使われるため、表示名の揺れをここで固定する。
const name = normalizeWorkflowName(model.metadata.name)
```

## 9. コメント粒度

### 9.1 JSDoc

exported API、command entry、provider entry には JSDoc を使う。

```ts
/**
 * workflow-register に公開する action provider を登録する。
 *
 * provider ID は WORKFLOW.md から参照される互換性契約である。
 * 処理本体を分割しても provider ID は変更しない。
 */
export function registerWorkflowProviders(...): Promise<void> {
  // ...
}
```

### 9.2 短い境界コメント

関数内の特定分岐や安全境界には、短いコメントを使う。

```ts
// workflow args は workspace 所有者が編集できるため、executable path の上書きには使わない。
```

### 9.3 制限事項コメント

軽量解析や fallback には、限界を明示する。

```ts
// fenced block が複数ある場合は曖昧なため、最初の候補を黙って採用しない。
```

## 10. CODEX 向け実装ルール

CODEX に実装を依頼する場合は、次のルールをプロンプトまたは作業指示に含める。

```md
## コメント判断ルール

実装時、次に該当する場合だけコメントを追加・更新する。

1. exported API / provider / command entry の契約を変更した。
2. workspace path、外部コマンド、VCS revision、生成物出力の信頼境界を変更した。
3. AI 出力と人間承認の責務境界を変更した。
4. 互換性維持のために一見不要な処理を残した。
5. fallback、canonicalize、repair、backup など、誤解されやすい救済処理を変更した。

コメント本文は日本語で書く。
ただし、関数名、型名、API 名、command ID、provider ID、schema field、JSDoc タグは実コード上の表記を維持する。

コメントは what ではなく why / boundary / invariant を書く。
```

## 11. PR チェックリスト

PR テンプレートには、次の確認項目を追加する。

```md
## Comment / Context Check

- [ ] Public API / exported type の契約が変わる場合、JSDoc を更新した。
- [ ] path / command / VCS / generated artifact の安全境界が変わる場合、理由コメントを更新した。
- [ ] AI 判断と人間承認の境界が変わる場合、コメントまたは設計書を更新した。
- [ ] command ID / provider ID / schema version などの互換性契約を変更していない、または移行方針を書いた。
- [ ] 自明なコメントや仕様書の丸写しを追加していない。
```

## 12. 段階的な導入計画

### Phase 0: 棚卸し

コメントを全量追加するのではなく、高リスク箇所を洗い出す。

優先順位:

1. `workflow-register` の中心型、engine、provider API、result sink API。
2. `bob-code-consistency-review` の path、VCS、generated artifact、traceability、Bob output validation。
3. `bob-bazaar-review` の Bazaar CLI、MCP、workflow bridge。
4. Webview message boundary。
5. 仕様書とコードの対応が薄い箇所。

### Phase 1: 共通方針の適用

本ドキュメントをリポジトリ共通の基準とし、既存の `docs/workflow-register-commenting-guideline-ja.md` は workflow-register 固有の補助方針として扱う。

### Phase 2: 高リスク箇所への backfill

以下の順でコメントを追加する。

- workspace path resolver。
- Git / Bazaar diff collector。
- workflow provider registration。
- traceability AI draft merge。
- Bob output capture / canonicalize / validation。
- Webview save / approval message handling。
- generated artifact writer。

### Phase 3: PR 運用へ組み込む

PR テンプレートまたはレビュー観点に Comment / Context Check を追加する。

### Phase 4: 機械チェックと分割

コメントで補うより型分割・モジュール分割の方が適切な箇所は、段階的に構造で解消する。

候補:

- `workflow-register/src/core/model.ts` を schema types、runtime types、provider API types、result sink types へ分割する。
- `bob-code-consistency-review/src/core` を review-input、diff、documents、traceability、bob-output へ分割する。
- dependency-cruiser などで依存方向を検査する。

## 13. 更新ルール

- 挙動を変える PR では、該当する責務コメントと README / 設計書を確認する。
- コメントが実装と矛盾した場合、コメントを削るか修正する。
- 迷った場合は、「何をしているか」より「なぜそうしているか」を書く。
- コメントだけで補えない複雑さは、ファイル分割、型分割、テスト追加で解消する。

## 14. 参考ドキュメント

- `docs/workflow-register-commenting-guideline-ja.md`
- `docs/workflows/code-consistency-review/README.md`
- `docs/workflows/code-consistency-review/mvp-architecture.md`
- `extensions/workflow-register/docs/detailed-design-ja.md`
- `extensions/bob-code-consistency-review/docs/detailed-design-ja.md`
- `extensions/bob-bazaar-review/docs/detailed-design-ja.md`
- `docs/extensions-maintainability-review-2026-07-04-14afe83c.md`
- `docs/workflow-register-maintainability-review-2026-07-04-14afe83c.md`
- `docs/bob-code-consistency-review-deep-review-2026-07-04-14afe83c.md`

## 15. 結論

本プロジェクトでは、コメントを大量に増やす必要はない。

ただし、仕様書を読んだ CODEX 前提だけに依存すると、将来の人間レビュー、別 AI による修正、部分的な保守で文脈が失われる。

そのため、コメントは次の領域に限定して義務化する。

- 保守上の契約。
- 安全境界。
- 互換性制約。
- AI と人間の責務境界。
- 近似、fallback、repair、canonicalize の限界。
- 副作用と生成物の機密性。

これにより、コードの読みやすさを保ちながら、仕様書依存・CODEX 依存のリスクを下げられる。
