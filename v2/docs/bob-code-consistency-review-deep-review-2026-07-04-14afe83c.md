# bob-code-consistency-review 詳細レビュー

- 対象リポジトリ: `katamor1/bob_builtin_analyze`
- 対象 ref: `14afe83c2218d881a9cd7b17b68b837c53507114`
- 対象拡張: `extensions/bob-code-consistency-review`
- レビュー日: 2026-07-04

## 0. レビュー方法と前提

本レビューは GitHub 上のソースコード、README、`package.json`、schema、主要テスト配置を対象にした静的レビューである。VS Code Extension Host 上での実行、IBM Bob 本体との実接続、`npm install` / `npm test` / `npm audit` はこのレビュー内では実行していない。

重点観点は以下。

- `review-input.yaml` 作成・検証・AI draft 取り込み
- Git / Bazaar diff 収集と外部プロセス実行
- Markdown / DOCX / XLSX 文書抽出
- C/C++ 変更解析と evidence 生成
- review package / Bob input / Bob output / human triage の生成物
- traceability sidecar catalog と AI draft merge
- workflow-register action provider 連携
- workspace path boundary、サイズ上限、機密情報、誤コミットリスク

## 1. 総評

`bob-code-consistency-review` は、「コード変更」と「要求・設計・テスト仕様」の整合プレレビューを実行可能なパイプラインとして形にしており、責務分割はかなり進んでいる。`extension.ts` は command 登録と orchestration に寄せられ、実処理は `core/*`、`analyzers/*`、`triage/*`、`webview/*` に分かれている。AI に最終 YAML や採否判断を直接させず、`ReviewInputDraft`、builder、schema validator、evidence index を通す設計思想も良い。

一方で、この拡張はローカル workspace、VCS、設計文書、raw diff、Bob/AI 出力、traceability catalog を一気通貫で扱う。つまり「便利なレビュー補助」であると同時に、workspace 内外のファイル読み書き、外部コマンド、機密情報を含む大きな生成物を扱う自動化でもある。現状は基本的な型/schema検証はあるが、パス境界・revision検証・サイズ上限・生成物の機密性にまだ揺れがある。

最優先で直したいのは以下である。

1. path resolver を統一し、デフォルトで workspace 外の読み書きを拒否する。
2. Git / Bazaar revision を実行前に検証・正規化する。
3. `bzrPath` / `diffFixturePath` / 出力先 path を workflow args から上書きできる範囲を制限する。
4. Bob output canonicalizer が AI 出力を補いすぎて validation を通してしまう問題を分離する。
5. 文書抽出・diff・Bob input 生成にサイズ上限と truncation policy を入れる。
6. `.bob-review`、`.bob-trace`、Bob output、triage に機密情報が含まれることを前提に ignore/helper/警告を整備する。

## 2. 優先度付き指摘一覧

Severity は次の意味で使う。

- High: セキュリティ、機密情報、任意パス/任意コマンド、レビュー結果の信頼性に重大な影響がある。
- Medium: 誤結果、DoS、運用事故、再現性低下につながる可能性がある。
- Low: 保守性、ユーザー体験、将来拡張性の改善。

| ID | Severity | 領域 | 指摘 | 影響 | 推奨対応 |
|---|---:|---|---|---|---|
| CCR-01 | High | Path boundary | `absolute()` / `resolveWorkspacePath()` が absolute path を許容し、複数の読み書き経路で workspace 外を扱える | workflow args / config / hand-written YAML から任意ファイル読み書きに広がる | 共通 `resolveWorkspacePathStrict` を導入し default deny。外部 path は明示 opt-in + 警告 |
| CCR-02 | High | VCS execution | Git/Bazaar revision が schema `minLength` 程度で、CLI args に直接入る | shell injection ではないが option injection / 意図しない revision 解決 / 異常挙動 | Git は `rev-parse --verify --end-of-options` で SHA 化。Bazaar は `validateRevision` 相当を共有 |
| CCR-03 | High | External executable | `bzrPath` を config / workflow args で上書きでき、任意 executable path を実行し得る | trusted workspace 前提でも、workflow 経由の任意ローカル実行面が増える | `bzrPath` は user/global 設定のみ許可、workspace args override は confirmation または禁止 |
| CCR-04 | High | Output integrity | Bob output canonicalizer が不足フィールド・ID・category・final_approval 等を補正してから保存する | AI が契約に従わない出力でも正規化後に valid 扱いされ、レビュー品質の信頼性が落ちる | raw validation と canonicalized validation を分離し、補正を warning/error として report |
| CCR-05 | High | Generated artifacts | `.bob-review` / `.bob-trace` に raw diff、文書抜粋、Bob input、triage を生成するが target project 側 ignore は保証されない | コード・設計書・顧客情報・AI出力の誤コミット/共有 | initializer で `.gitignore` helper、生成時の機密警告、redaction option を追加 |
| CCR-06 | Medium | Resource limits | Markdown/DOCX/XLSX/diff/code slice 生成に一貫したサイズ上限がない | 大きな文書や巨大 diff で Extension Host のメモリ/時間を圧迫 | file bytes、sheet/row、excerpt bytes、raw diff bytes、bob-input bytes を設定化 |
| CCR-07 | Medium | Review correctness | `reviewInputValidator` は hand-written artifact path の存在のみ確認し、workspace 内確認をしない | 手書き YAML では builder より緩く、外部文書を読める | validator 側でも workspace containment を必須化 |
| CCR-08 | Medium | Traceability | AI traceability draft は proposed-only を強制するが、構造の深い検証前に catalog へ書ける | gate report で後追い検出できても、不正/巨大/壊れた proposed データが永続化される | merge 前に lightweight schema validation と item count / field size limits を入れる |
| CCR-09 | Medium | Discovery | `docsRoot` が `..` を含む場合、文書 discovery が workspace 外へ出る可能性がある | AI draft prompt に workspace 外文書候補を混ぜる | docsRoot も strict resolver 対象にする |
| CCR-10 | Medium | Bob output fallback | Bob output capture/validate/triage が primary なしで packageDir fallback を読む | 古い `review-package/bob-output.yaml` を誤って検証/triage する可能性 | fallback 使用時は明示 confirmation、または run/review_id 一致確認 |
| CCR-11 | Medium | Analyzer correctness | C/C++ analyzer が direct path 不在時に basename 探索の先頭候補を使う | 同名ファイルが複数あると誤ったコード slice / evidence を作る | basename fallback は候補複数なら warning + 不採用、または diff path 類似度で選ぶ |
| CCR-12 | Medium | Package freshness | review package 出力先を clean せず、古い `code-slices/` や `tables/` が残り得る | 人間が古い生成物を参照し、混乱する | build 開始時に管理対象ファイル/dirを掃除、manifest に generation id を入れる |
| CCR-13 | Medium | YAML/JSON parsing | Bob output / AI draft 抽出が first/last brace や最初の fenced block に依存 | prose 混入時の誤抽出・巨大入力 parse・曖昧なエラー | balanced parser、最大入力 bytes、複数候補時の明示エラー |
| CCR-14 | Medium | Workflow options | `mergeOptions(input.inputs, input.args)` で workflow inputs と action args が同列、args が path/command系も上書きできる | workflow 定義や外部 action provider 経由で安全設定を上書きできる | user input と trusted command options を分離し、dangerous keys は blocklist |
| CCR-15 | Low | Notification | `notifyInfo` は status bar と console のみで、重要な生成物/警告が見落とされやすい | バックアップや警告件数をユーザーが見逃す | 重要操作は `showInformationMessage` + report document |
| CCR-16 | Low | Schema/CI | lockfile / audit / dependency policy が見えない | `xlsx` / `mammoth` 等の supply-chain 監査が弱い | lockfile、audit、license/SBOM、VSIX build CI |

## 3. アーキテクチャ詳細

### 3.1 Command surface

`package.json` は `bobCodeConsistency.*` の command 群を公開し、`extension.ts` がそれらを登録する。主な command は次の4群に分かれる。

1. workspace 初期化: `initializeWorkspace`
2. review-input 作成: wizard、AI draft、repair、diagnostics
3. traceability: AI draft、catalog apply、prep webview、gate、review-input 生成
4. 実行系: preprocess、Bob output capture、validate、triage

この分割は良い。ただし `extension.ts` から呼ばれる多くの command が `optionRecord(options)` を通して workflow args / command args を受け、path や VCS option を上書きできる。workflow-register 連携ではこの柔軟性が便利だが、dangerous option を区別していない点がリスクである。

### 3.2 Pipeline

`preprocessReview()` は以下を順に実行する。

```text
validateReviewInput
  -> collectGitDiff
  -> extractDocuments
  -> analyzeCppChanges
  -> buildTraceability
  -> buildReviewPackage
```

この流れは明快で、個別テストもしやすい。一方、各段階の入力サイズ・path境界・fallback policy が分散しているため、review package の信頼性と安全性を担保するには「入口で正規化済み/検証済み input object」を作るのが望ましい。

推奨する内部境界:

```ts
type SafeWorkspacePath = string & { readonly __safeWorkspacePath: unique symbol }
type SafeGitCommit = string & { readonly __safeGitCommit: unique symbol }
type SafeBazaarRevision = string & { readonly __safeBazaarRevision: unique symbol }
```

ここまで型ブランドにしなくても、少なくとも `resolveAndValidateExecutionOptions()` のような前段で、workspace root / VCS root / input path / output dirs / revisions / executables をすべて正規化してから pipeline に渡すとよい。

## 4. 詳細指摘

## CCR-01 / CCR-07: workspace path boundary が一貫しない

### 観察

`extensionCommandOptions.absolute()` は、入力値が absolute path の場合そのまま返す。`core/fileSystem.resolveWorkspacePath()` も absolute path を許容する。これらは `runPreprocess`、`runCaptureBobOutput`、`runValidateOutput`、`runTriage`、traceability 系 command、review-input validation など広範囲で使われる。

一方で、`buildReviewInputFromDraft()` は `artifact.path` が workspace 外へ出ないよう `isInsideWorkspace()` で検証している。つまり、AI draft / wizard 由来は比較的安全だが、手書き `review-input.yaml` や workflow args 経由は緩くなる。

### 影響

- `reviewInputPath=/absolute/outside.yaml` で workspace 外の YAML を読める。
- `reviewPackagePath=/absolute/outside` で workspace 外へ package を生成できる。
- `bobOutputPath` / `triagePath` / `traceabilityCatalogPath` も workspace 外へ書ける。
- hand-written `review-input.yaml` の `artifacts.*[].path` が absolute path でも、存在すれば読み込まれる。
- Bob/AI に渡す `bob-input.md` に workspace 外文書の抜粋が混ざる。

### 推奨対応

1. `core/fileSystem.ts` に以下のような関数を追加する。

```ts
export function resolveWorkspacePathStrict(
  workspaceRoot: string,
  value: string,
  options: { allowExternal?: boolean; label?: string } = {}
): string {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(path.isAbsolute(value) ? value : path.join(root, value))
  const relative = path.relative(root, target)
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  if (!inside && !options.allowExternal) {
    throw new Error(`${options.label ?? "path"} escapes workspace: ${value}`)
  }
  return target
}
```

2. output 系 path は原則 workspace 内固定にする。
3. external artifact をどうしても許可する場合は `BOB_CODE_CONSISTENCY_ALLOW_EXTERNAL_PATHS=1` と UI confirmation の両方を要求する。
4. `validateReviewInput()` の `missingArtifactPaths()` でも workspace containment を検査する。
5. `traceabilityCatalogStore.resolveCatalogPath()` も strict resolver に合わせる。

## CCR-02: Git / Bazaar revision validation が弱い

### 観察

`collectStandardGitDiff()` は `reviewInput.review.base` / `head` をそのまま `git diff --name-status base head`、`git diff --numstat base head`、`git diff --unified=80 base head` に渡す。`collectBazaarDiff()` は `base..head` を組み立てて `bzr --no-aliases diff -r <range>` に渡す。

`execFile` なので shell injection ではないが、Git は `-` で始まる値を option として解釈し得る。Bazaar もこの拡張では `bob-bazaar-review` 側にある `validateRevision` 相当の allowlist を再利用していない。

### 影響

- `base` / `head` に意図しない option が入る可能性。
- `vcs_root` と組み合わせて想定外 repository を対象にできる。
- AI draft prompt 生成時にも `base` / `head` を使って diff summary を取るため、レビュー入力作成段階で外部プロセス実行が走る。

### 推奨対応

Git:

```text
git rev-parse --verify --end-of-options <base>^{commit}
git rev-parse --verify --end-of-options <head>^{commit}
git diff --name-status <baseSha> <headSha>
```

Bazaar:

- `bob-bazaar-review/src/bazaar.ts` の `validateRevision()` を共通 utility として切り出す。
- `baseRevision` / `targetRevision` をそれぞれ検証してから range を組み立てる。

テスト:

- `base: --output=/tmp/x`
- `head: -c credential.helper=...`
- `base: ../foo`
- `bazaar` revision に空白、quote、semicolon、backslash、NUL 相当

## CCR-03: `bzrPath` を workflow args で上書きできる

### 観察

`runPreprocess()`、AI draft prompt 生成、traceability AI draft prompt 生成などで `bzrPath` は `stringOption(record, "bzrPath") ?? config.get(...)` の順に解決される。workflow-register action provider 経由の場合、`record` は workflow inputs / args から作られる。

### 影響

- `bzrPath` に任意 executable path を指定できる。
- `execFile` + `shell:false` なので shell injection ではないが、実行ファイルそのものの差し替えは任意コマンド実行に近い。
- VS Code workspace trust を前提にするなら許容できる部分もあるが、少なくとも「review workflow の引数で executable を差し替え可能」は危険度が高い。

### 推奨対応

- `bzrPath` は user/global config のみ許可し、workflow args からの override は禁止する。
- どうしても override する場合は `allowBzrPathOverride: true` の明示 config と modal confirmation を要求する。
- 実行前 report に `vcs`, `vcsRoot`, `bzrPath`, `base`, `head` を表示する。

## CCR-04: Bob output canonicalizer が補正しすぎる

### 観察

`captureBobOutput()` は YAML parse 後に `canonicalizeBobOutput()` を通し、正規化 YAML を保存する。canonicalizer は `review_summary.result_type` を `pre_review`、`final_approval` を `not_performed`、`scope_statement` を fallback text で補完する。また finding ID、question ID、coverage ID、uncertain ID を自動採番し、未知 category を `risk` や `missing-evidence` へ寄せる。

### 影響

- Bob/AI が出力契約に従っていない場合でも、拡張側が valid-looking な出力へ変換してしまう。
- 「AI が final approval をしていない」ことを確認する目的の schema が、補完によって弱くなる。
- evidence ID も lookup や prefix 推定で補われるため、raw output の品質問題が見えにくくなる。

### 推奨対応

1. `raw-output.yaml` と `canonical-output.yaml` を両方保存する。
2. raw validation を先に実施し、schema違反は error または少なくとも high severity warning とする。
3. canonicalizer は `CanonicalizationReport` を返す。

```ts
type CanonicalizationIssue = {
  severity: "error" | "warning" | "info"
  path: string
  code: string
  message: string
}
```

4. 補完した field、置換した category、生成した ID、捨てた additional field を report に残す。
5. `validateOutput` は raw/canonical の両方の結果を表示する。

## CCR-05: generated artifacts の機密情報リスク

### 観察

`buildReviewPackage()` は以下を生成する。

- `diff-context.md`: raw unified diff とコード slice
- `document-excerpts.md`: 要求・設計・テスト仕様・台帳等の抜粋
- `bob-input.md`: Bob に投入する統合 prompt
- `code-slices/*.md` / `tables/*.md`
- `input-normalized.json`、`changed-symbols.json`、`evidence-index.json`

traceability 側は `.bob-trace/traceability-catalog.json`、`gate-report.md`、AI draft prompt を生成する。triage 側は `.bob-review/human-triage` に Bob 出力由来の Markdown/YAML を生成する。

### 影響

- 社内設計書・顧客仕様・ソースコード・raw diff がそのまま残る。
- target project 側に `.bob-review/` / `.bob-trace/` の ignore があるとは限らない。
- Bob output や triage にはAIが要約した機密文脈も含まれる。

### 推奨対応

- `initializeWorkspace` に `.gitignore` helper を追加する。
- 推奨 ignore:

```gitignore
.bob-review/
.bob-trace/ai-traceability-draft/
.bob/workflows/runs/
```

- `traceability-catalog.json` は成果物として version 管理する運用もあり得るため、`.bob-trace/` 全体を無条件 ignore するかはプロジェクト選択にする。
- 生成完了時に「機密情報を含む可能性」を notification / report に表示する。
- redaction option を将来追加する。

## CCR-06: 文書抽出・diff・Bob input のサイズ上限不足

### 観察

- Markdown は全文 read。
- DOCX は `mammoth.convertToHtml({ path })`。
- XLSX は `XLSX.readFile()` で workbook を開く。discovery では `sheetRows: 80` があるが、本抽出側は全 sheet / 全 row を処理し得る。
- Git/Bazaar unified diff は最大 buffer 50MB。
- `buildReviewPackage()` は raw unified diff を `diff-context.md` に丸ごと入れる。

### 影響

- Extension Host のメモリ圧迫。
- Bob input の肥大化。
- ユーザーが気づかず巨大な文書抜粋を Bob へ投入する。
- `.bob-review` の保存容量が大きくなる。

### 推奨対応

設定例:

```json
{
  "bobCodeConsistency.maxDocumentBytes": 5242880,
  "bobCodeConsistency.maxWorkbookSheets": 20,
  "bobCodeConsistency.maxRowsPerSheet": 500,
  "bobCodeConsistency.maxExcerptBytesPerDocument": 65536,
  "bobCodeConsistency.maxRawDiffBytes": 1048576,
  "bobCodeConsistency.maxBobInputBytes": 2097152
}
```

truncation は `deterministic-checks.md` と `manifest.yaml` に必ず記録する。

## CCR-08: traceability AI draft の永続化前検証が浅い

### 観察

`parseAiTraceabilityDraft()` は top-level object、`schema_version`、array であること、AI が `accepted` 状態や accepted endpoint を作らないことは確認する。その後、`mergeAiTraceabilityDraft()` で existing catalog と merge し、`writeTraceabilityCatalog()` で保存する。gate report は apply command 側で保存後に実行される。

### 影響

- proposed item の細かい必須 field、重複、極端な件数、巨大文字列などは保存前に十分制限されない。
- gate report が error を出すとしても、不正 proposed data は catalog に残る。
- Webview が巨大 catalog を開く時に重くなる。

### 推奨対応

- proposed draft 用 JSON schema を作る。
- merge 前に以下を制限する。
  - documents/domains/items/links/decisions の件数
  - 各 string field の最大文字数
  - `source_path` の workspace containment
  - unknown field の拒否または warning
- apply 結果が gate error の場合は保存を rollback する option を検討する。

## CCR-09: `docsRoot` の workspace escape

### 観察

`discoverReviewInputCandidates()` は `root = path.join(workspaceRoot, options.docsRoot ?? "docs")` で探索 root を作る。`docsRoot` に `../..` を含められる場合、workspace 外へ出られる可能性がある。

### 推奨対応

- `docsRoot` も strict workspace resolver 対象にする。
- hidden directory、`node_modules` 以外にも `.git`, `.bzr`, `.bob-review`, `.bob-trace`, `out`, `dist` を skip する。
- symlink traversal も方針を決める。

## CCR-10: Bob output fallback が stale output を拾い得る

### 観察

`readBobOutputText()` は primary path のほか、`packageDir/bob-output.yaml` も候補にする。primary がなく、古い packageDir 内に `bob-output.yaml` があると、それを validate / triage 対象にする。

### 影響

- 別レビューの Bob output を誤って検証・triage する。
- ユーザーが「最新の出力を検証した」と誤解する。

### 推奨対応

- fallback 使用時は review id / target range を package manifest と照合する。
- fallback が使われたら modal confirmation または clear warning を出す。
- `captureBobOutput` は primary なし fallback を原則しない。

## CCR-11: C/C++ analyzer の basename fallback

### 観察

`resolveSourceFile()` は diff path の direct file が見つからない場合、workspace 内を basename で探索し、最初の候補を返す。

### 影響

- `src/a/foo.c` と `tests/foo.c` がある場合、diff path と違うファイルを code slice に使う可能性がある。
- evidence ID と raw diff の対応が壊れ、Bob output validation では検出できない。

### 推奨対応

- basename fallback は候補1件の場合のみ使う。
- 複数候補なら warning にして code slice を作らない。
- diff path の parent suffix 類似度で ranking する場合でも、選択理由を warnings に出す。

## CCR-12: package 出力先の stale files

### 観察

`buildReviewPackage()` は `fs.mkdir(outDir, { recursive: true })` 後に各ファイルを書き込むが、既存 `code-slices/` や `tables/` の掃除はしない。

### 影響

- 前回 run の slice/table が残る。
- 人間が `review-package` directory を手で見ると古い根拠を参照し得る。

### 推奨対応

- 管理対象 directory を build 前に削除する。
- または `.bob-review/review-package/<reviewId>-<timestamp>` のように run ごとに別 directory にする。
- `latest` symlink / marker は必要なら明示的に管理する。

## CCR-13: AI draft / Bob output 抽出ロジックの曖昧さ

### 観察

AI review-input draft、traceability draft、Bob output は fenced block や first/last brace から本文を抽出する。単純で便利だが、複数 JSON/YAML がある場合や prose に brace がある場合に曖昧になる。

### 推奨対応

- balanced JSON extractor を共通化する。
- 複数 JSON 候補がある場合はエラーにし、どの候補を使ったか report に出す。
- 入力 text の最大 bytes を設定化する。
- clipboard から読む場合は読み込み前にサイズを確認し、巨大 clipboard を拒否する。

## CCR-14: workflow inputs と trusted command options が混ざっている

### 観察

workflow provider registration は `mergeWorkflowOptions(input)` で `input.inputs` と `input.args` を merge し、`workflowContextOptions` を足す。capture 系も `buildCaptureWorkflowOptions()` が同様に options を merge する。

### 影響

- ユーザー入力として設計された workflow inputs と、拡張内部の trusted option が同じ object に入る。
- `reviewPackagePath`、`bobOutputPath`、`triagePath`、`bzrPath`、`diffFixturePath` なども input/args で上書きできる。

### 推奨対応

- `safeUserInputs` と `trustedExecutionOptions` を分ける。
- workflow YAML から渡せる key を command ごとに allowlist する。
- dangerous keys は action provider 側で拒否する。

例:

```ts
const ALLOWED_PREPROCESS_ARGS = new Set([
  "reviewInputPath",
  "reviewPackagePath",
  "textEncoding"
])
const BLOCKED_FROM_WORKFLOW = new Set([
  "bzrPath",
  "diffFixturePath",
  "workspaceRoot",
  "bobRoot"
])
```

## CCR-15: notification が軽すぎる

`notifyInfo()` は `console.info` と status bar message のみで、生成先、backup path、warning 件数などが見落とされやすい。review package や traceability gate report のような重要操作では Markdown report を開くか、`showInformationMessage` に `Open Report` action を出す方がよい。

## CCR-16: dependency / CI

この拡張は `ajv`、`cheerio`、`mammoth`、`xlsx`、`yaml` を使う。特に Office 文書や spreadsheet parser は supply-chain / parser bug の影響が大きい。lockfile が見えないため、VSIX build の再現性と audit が弱い。

推奨:

- `package-lock.json` をコミットする。
- CI で `npm ci`、`npm test`、`npm audit --omit=dev`、license check、VSIX package を実行する。
- generated package の smoke test を fixture 付きで回す。

## 5. 良い設計・維持したい点

- AI に最終 `review-input.yaml` を直接書かせず、`ReviewInputDraft` -> `ReviewInputBuilder` -> schema validator の流れにしている。
- `buildReviewInputFromDraft()` は artifact path の workspace escape を検出しており、この方針は全 resolver へ展開すべき。
- Bob output は schema と `evidence-index.json` を照合しており、evidence hallucination を検出する方向性は良い。
- traceability AI draft は proposed-only に制限し、人間が accepted/rejected/deprecated を判断するモデルになっている。
- `workflowProviderRegistration.ts` で workflow-register action provider 連携を分離しており、コマンドと workflow 呼び出しを同じ handler に寄せている点は保守しやすい。
- `workspaceInitializer.ts` は既存 `review-input.yaml` を上書きせず backup のみにしており、実案件データを壊しにくい。

## 6. 推奨修正順

### PR 1: 安全境界の共通化

- `resolveWorkspacePathStrict` 導入。
- `absolute()` / `optionalAbsolute()` の使用箇所を置き換え。
- `reviewInputValidator`、`traceabilityCatalogStore`、`readBobOutputText`、`runPreprocess`、`runTriage` に workspace containment を適用。
- `docsRoot`、`vcs_root`、`diffFixturePath` の扱いを明確化。

### PR 2: VCS execution hardening

- Git revision を SHA に解決。
- Bazaar revision validator を共有。
- `bzrPath` override 制限。
- VCS command execution report を追加。

### PR 3: Bob output validation の二層化

- raw output 保存。
- raw validation / canonical validation / canonicalization report を分離。
- 補正項目を warning 化。
- `validateOutput` と triage で report を表示。

### PR 4: サイズ上限・生成物管理

- document/diff/excerpt/bob-input サイズ上限。
- package output directory cleanup。
- `.gitignore` helper。
- generated artifacts privacy notice。

### PR 5: traceability draft schema と Webview robustness

- proposed draft schema。
- item count / field length limits。
- gate error 時の rollback option。
- Webview で巨大 catalog を開く前の guard。

## 7. 追加したいテスト

### Path boundary

- `review-input.yaml` の artifact path が `/tmp/secret.md` の場合に reject。
- `reviewPackagePath` が workspace 外の場合に reject。
- `traceabilityCatalogPath` が workspace 外の場合に reject。
- `docsRoot: ../outside` を reject。
- `diffFixturePath` が workspace 外の場合に reject または explicit opt-in required。

### VCS

- Git `base` / `head` が `--output=x` の場合に reject。
- Git valid ref が SHA に解決される。
- Bazaar revision に空白や shell metachar がある場合に reject。
- `bzrPath` workflow args override が reject される。

### Bob output

- raw output が schema 違反だが canonicalizer で補正可能な場合、warning/error report が出る。
- evidence_id なし evidence が canonicalizer で補完された場合、補完 report が出る。
- fallback `packageDir/bob-output.yaml` 使用時に warning が出る。

### Resource limits

- 巨大 Markdown / XLSX / DOCX fixture を truncation warning 付きで処理。
- raw diff が上限を超えた場合、`diff-context.md` と manifest に truncation が残る。
- 古い `code-slices/OLD.md` が次回 package build で残らない。

### Analyzer correctness

- 同名 `foo.c` が複数ある場合、basename fallback で誤選択しない。
- direct diff path が存在しない場合は warning を出して code slice を作らない。

## 8. 主要確認ファイル

- `extensions/bob-code-consistency-review/package.json`
- `extensions/bob-code-consistency-review/README.md`
- `extensions/bob-code-consistency-review/src/extension.ts`
- `extensions/bob-code-consistency-review/src/extensionCommandOptions.ts`
- `extensions/bob-code-consistency-review/src/workflowProviderRegistration.ts`
- `extensions/bob-code-consistency-review/src/workflowOptions.ts`
- `extensions/bob-code-consistency-review/src/reviewExecutionCommands.ts`
- `extensions/bob-code-consistency-review/src/traceabilityCommands.ts`
- `extensions/bob-code-consistency-review/src/workspaceInitializer.ts`
- `extensions/bob-code-consistency-review/src/core/fileSystem.ts`
- `extensions/bob-code-consistency-review/src/core/reviewInputBuilder.ts`
- `extensions/bob-code-consistency-review/src/core/reviewInputValidator.ts`
- `extensions/bob-code-consistency-review/src/core/reviewInputAiDraftProvider.ts`
- `extensions/bob-code-consistency-review/src/core/reviewInputDiscovery.ts`
- `extensions/bob-code-consistency-review/src/core/gitDiffCollector.ts`
- `extensions/bob-code-consistency-review/src/core/pipeline.ts`
- `extensions/bob-code-consistency-review/src/core/reviewPackageBuilder.ts`
- `extensions/bob-code-consistency-review/src/core/bobOutputCapture.ts`
- `extensions/bob-code-consistency-review/src/core/bobOutputSource.ts`
- `extensions/bob-code-consistency-review/src/core/bobOutputCanonicalizer.ts`
- `extensions/bob-code-consistency-review/src/core/bobOutputValidator.ts`
- `extensions/bob-code-consistency-review/src/core/traceabilityAiDraftProvider.ts`
- `extensions/bob-code-consistency-review/src/core/traceabilityCatalogStore.ts`
- `extensions/bob-code-consistency-review/src/core/traceabilityValidation.ts`
- `extensions/bob-code-consistency-review/src/analyzers/documentExtractor.ts`
- `extensions/bob-code-consistency-review/src/analyzers/cCppChangeAnalyzer.ts`
- `extensions/bob-code-consistency-review/src/triage/humanTriageHelper.ts`
- `extensions/bob-code-consistency-review/src/webview/traceabilityPrepWebview.ts`
- `extensions/bob-code-consistency-review/resources/schemas/review-input.schema.json`
- `extensions/bob-code-consistency-review/resources/schemas/bob-output.schema.json`

## 9. 結論

`bob-code-consistency-review` は、AI に任せきりにせず deterministic package と schema/evidence validation を挟む設計が強い。これはこの拡張の一番良いところなので維持したい。

ただし、現状は「安全な builder 経由」と「手書き YAML / workflow args / config 経由」で検証強度が揃っていない。特に workspace 外 path、VCS revision、executable path、生成物の機密性、Bob output の過剰補正は先に固めるべきである。これらを直すと、正式レビュー前の補助ツールとしてかなり堅い品質になる。
