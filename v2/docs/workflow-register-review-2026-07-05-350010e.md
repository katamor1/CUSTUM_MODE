# workflow-register 拡張機能レビュー（350010e / 2026-07-05）

## レビュー対象

- Repository: `katamor1/bob_builtin_analyze`
- 対象 commit: `350010e766d99ad19a0bba5bf11e2cbd0ee04e62`
- 対象範囲: `extensions/workflow-register` と、同拡張に関係する `docs/` / `.bob/template-library/standard/process-code-precheck/` / CI 設定
- 主な観点:
  - コーディング
  - ドキュメントの整合性
  - 仕様に対するテストの存在と整合性

## レビュー方法と制約

GitHub 上の対象 commit のファイル内容を静的に確認した。ローカルで `npm test` や VS Code Extension Host を実行する検証は実施していない。対象 commit に対する GitHub combined status は空で、workflow run も取得できなかったため、本レビューでは CI 実行結果を確認できていない。

## 総評

`Template Customization Studio` の追加は、`templateValidation` / `templateGenerator` / `templateReadiness` / `templateStudioModel` に責務を分けており、既存の workflow parser / validator を再利用する方向性はよい。`package.json` への command / activation / commandPalette 登録、`extensionWithAuthoring.ts` からの command 登録、Studio 用 Webview、preview / generate / diff / readiness の流れも一通り実装されている。

一方で、実運用前に直したい問題がいくつかある。特に、Webview 内へ workspace 由来データを `JSON.stringify` のまま埋め込む点、GUI で input default の型が失われる点、Git 既定 profile に Bazaar 専用の prompt supplement が入る点は優先度が高い。また、README / 基本設計 / 詳細設計 / テスト仕様が Phase 4 GUI Core の実装内容に追従できておらず、仕様とテストの対応を後から追いにくくなっている。

## 良い点

- `bobTemplate.openCustomizationStudio` は `package.json` の `activationEvents`、`contributes.commands`、`contributes.menus.commandPalette` に追加され、`extensionWithAuthoring.ts` でも command 登録されている。
- `templateValidation.ts` が template / project profile / customization の schema と safety rule をまとめており、Bazaar profile では `vcs.noAliases: true` を要求している。
- `templateGenerator.ts` は template / profile / customization の整合性、base template hash、customizable policy、生成後 workflow の metadata を扱っている。
- `templateReadiness.ts` は schema、生成、workflow parser、required files、guardrails、artifact path、human gate、template metadata、UAT evidence をまとめて readiness として返す構成になっている。
- `templateCustomizationStudio.test.js` と `templateCommands.test.js` は、標準テンプレートの検出、preview / generate、unsafe path、readiness pass / warning / fail、command 登録メタデータをカバーしている。

## 指摘事項

### P1-CODING-01: Webview の script 埋め込みが workspace 由来データに対して安全でない

**該当箇所**

- `extensions/workflow-register/src/webview/templateCustomizationStudioHtml.ts`
  - `const initialTemplates = ${JSON.stringify(options.templates)};`
  - `const initialModel = ${JSON.stringify(options.model)};`

**内容**

`metadata.yaml` の `displayName` / `description` など workspace 由来の値を、`JSON.stringify` しただけで `<script>` 内に直接埋め込んでいる。`</script>`、`<`、`&`、U+2028 / U+2029 などを escape していないため、悪意ある workspace で Webview script の文脈を壊せる可能性がある。

**影響**

Trusted Workspace 前提でも、Webview に workspace 由来 metadata を表示する以上、スクリプト文脈への直接挿入は避けたい。CSP の nonce は script tag 自体の実行許可には効くが、script の中身に注入された payload は同じ nonce 付き script として解釈される。

**推奨対応**

- `safeJsonForScript(value)` を用意し、少なくとも `<`, `>`, `&`, U+2028, U+2029 を escape する。
- 可能であれば `<script type="application/json">` へ安全化済み JSON を入れ、client script が `textContent` から parse する方式にする。
- `metadata.yaml` に `</script><script>...</script>` 相当の文字列を含めても HTML に raw `</script>` が出ないことをテストする。

### P1-CODING-02: Git 既定 profile でも Bazaar 専用 prompt supplement が入る

**該当箇所**

- `extensions/workflow-register/src/template/templateStudioModel.ts`
  - `createDefaultStudioModel()` は `supportedVcs` に `git` があれば `vcsType: "git"` を既定にする。
  - 同じ既定 model で `promptSupplement: "Bazaar 操作では bzr --no-aliases を使う。"` を常に設定している。
- `extensions/workflow-register/src/template/templateGenerator.ts`
  - `applyPromptSupplement()` は supplement を全 agent step の prompt に追記する。

**内容**

標準テンプレートは `git`, `bazaar`, `bzr` をサポートし、GUI の既定 VCS は `git` になり得る。しかし既定 prompt supplement は Bazaar 専用文言になっているため、Git プロジェクトで preview / generate した workflow にも `bzr --no-aliases` 指示が入る。

**影響**

Git プロジェクトの生成 workflow に不適切な VCS 操作指示が混入する。レビューや実行時の agent prompt が誤誘導されるため、品質面のリスクが高い。

**推奨対応**

- 既定 supplement は空にする。
- `vcsType` が `bazaar` / `bzr` の場合のみ Bazaar 文言を初期値にする。
- `vcsType` 変更時に UI 側で supplement を条件補完する場合も、既にユーザー編集済みの supplement を上書きしない。
- テストに「既定 Git model の preview には `bzr --no-aliases` が入らない」「Bazaar model には入る」を追加する。

### P1-CODING-03: GUI の input default 編集で number / boolean / null の型が失われる

**該当箇所**

- `extensions/workflow-register/src/webview/templateCustomizationStudioClientScript.ts`
  - `currentModel()` が `[data-input-default]` の `input.value` をそのまま `defaults[...]` に入れる。
- `extensions/workflow-register/src/template/templateValidation.ts`
  - `customize.inputs.defaults` は `string` / `number` / `boolean` / `null` を許可している。

**内容**

HTML input は文字列を返すため、元テンプレートの input default が `number` / `boolean` / `null` でも、GUI で model 化した時点で文字列になる。

**影響**

生成 workflow の input schema が意図せず変わる。特に boolean default が `false` ではなく `"false"` になると、実行時 input 解決や validator の意味が変わる可能性がある。

**推奨対応**

- `renderInputDefaults()` で元値の型を `data-input-default-type` として出す。
- client 側で type に応じて `number` / `boolean` / `null` を復元する。
- boolean は checkbox / select、number は `<input type="number">` を使うなど型別 control にする。
- テストに number / boolean / null default の round-trip を追加する。

### P2-CODING-04: workflow 生成時の書き込みが部分成功し得る

**該当箇所**

- `extensions/workflow-register/src/template/templateStudioModel.ts`
  - `generateWorkflowFromStudioModel()` が profile / customization / workflow を `Promise.all()` で同時書き込みする。
  - backup は既存 workflow の `WORKFLOW.md` だけで、profile / customization は対象外。

**内容**

生成時に `.bob/template-profiles/<projectId>.yaml`、`.bob/template-customizations/<workflowName>.yaml`、`.bob/workflows/<workflowName>/WORKFLOW.md` を同時に書く。いずれかで失敗した場合、他のファイルだけが更新済みになる可能性がある。また、既存 profile / customization の backup がない。

**影響**

template metadata と workflow の整合が崩れた状態が残り得る。再実行や diff の判断が難しくなる。

**推奨対応**

- 生成前に既存 profile / customization / workflow の backup 方針を統一する。
- 一時ファイルへ書いて rename する atomic write helper を導入する。
- 少なくとも「profile 書き込み成功、customization 書き込み失敗、workflow 未更新」などの failure path テストを追加する。

### P2-CODING-05: 書き込み時の symlink escape を検出していない

**該当箇所**

- `extensions/workflow-register/src/process/processPaths.ts`
  - `workspacePath()` は lexical な relative path 検証後に `path.resolve()` する。
  - `validateExistingWorkspacePath()` には `fs.realpath()` による symlink escape 検出がある。
- `extensions/workflow-register/src/template/templateStudioModel.ts`
  - `writeWorkspaceText()` は `workspacePath()` の結果へ `fs.writeFile()` する。

**内容**

`../` や absolute path は拒否できているが、workspace 内の symlink を経由して workspace 外へ書くケースは `writeWorkspaceText()` では realpath 検証されない。

**影響**

README / 設計上の「workspace root 外への成果物保存をしない」という方針に対し、symlink がある workspace では抜け道になる可能性がある。

**推奨対応**

- `safeWriteWorkspaceText()` のような共通 helper を作り、親ディレクトリの realpath が workspace realpath 配下であることを確認する。
- 新規ディレクトリ作成を伴う場合も、既存 parent chain の symlink を確認する。
- symlink を使った write escape テストを追加する。

### P2-CODING-06: GUI の `targetLanguage` / `vcs.type` 候補がテンプレート metadata と連動していない

**該当箇所**

- `extensions/workflow-register/src/webview/templateCustomizationStudioHtml.ts`
  - `targetLanguage` は固定で `c_cpp`, `csharp`, `java`, `javascript_typescript`, `python`, `sql`, `docs`, `other`。
  - `vcs.type` は固定で `git`, `bazaar`, `bzr`, `none`。
- `.bob/template-library/standard/process-code-precheck/metadata.yaml`
  - `supportedLanguages` は `c_cpp`, `csharp`, `java`, `javascript_typescript`, `python`。
  - `supportedVcs` は `git`, `bazaar`, `bzr`。

**内容**

UI では、選択中テンプレートがサポートしない値も選べる。validator で拒否されるため安全側ではあるが、GUI としては「安全編集フォーム」の期待に反する。

**影響**

ユーザーが `sql` / `docs` / `other` / `none` を選べてしまい、preview / generate でエラーになる。テンプレートごとのサポート範囲を UI が表現できていない。

**推奨対応**

- select 候補を `TemplateLibraryEntry.supportedLanguages` / `supportedVcs` から生成する。
- `loadTemplate` 時に候補と現在値を再同期する。
- テストに「標準テンプレートの UI には unsupported option が出ない」を追加する。

### P2-CODING-07: `artifactOutputRoot` の置換範囲が仕様上あいまいで、一部 artifact が置換されない

**該当箇所**

- `extensions/workflow-register/src/template/templateGenerator.ts`
  - `CODE_PRECHECK_ARTIFACT_ROOT = ".bob-process-runs/{{run.id}}/code-precheck"`
  - `replaceArtifactPath()` はこの prefix で始まる文字列だけを置換する。
- `.bob/template-library/standard/process-code-precheck/WORKFLOW.md`
  - `evidenceIndex` は `.bob-process-runs/{{run.id}}/evidence-index.json`。
  - `reviewResult` / `phase2Handoff` は `.bob-process-runs/{{run.id}}/code-precheck/...`。

**内容**

Studio / UAT では `artifact output root` を編集対象として扱っているが、実装は `code-precheck` 配下の path だけを置換する。`evidence-index.json` など run root 直下の artifact は既定 path のまま残る。

**影響**

ユーザーは artifact output root を変えたつもりでも、一部出力だけ旧 root に残る。これは仕様として許容するならドキュメント化が必要で、そうでないなら generator の置換範囲を広げる必要がある。

**推奨対応**

- `artifactOutputRoot` の意味を「code-precheck subtree の root」なのか「run artifacts 全体の root」なのか明文化する。
- 後者なら `.bob-process-runs/{{run.id}}` 配下の artifact / result sink / command args を一貫して置換する。
- テストに evidenceIndex など root 直下 artifact の期待値を追加する。

### P2-DOC-01: README / 基本設計 / 詳細設計が Template Customization Studio に追従していない

**該当箇所**

- `extensions/workflow-register/README.md`
- `extensions/workflow-register/docs/README-ja.md`
- `extensions/workflow-register/docs/basic-design-ja.md`
- `extensions/workflow-register/docs/detailed-design-ja.md`

**内容**

新規実装では Template Customization Studio、template library、project profile、customization、readiness report が追加されている。しかし README の最短手順や生成物、関連ドキュメントにはこれらがほぼ載っていない。基本設計 / 詳細設計も `src/template/`、`process/`、`bobTemplate.*` command、Studio Webview、readiness report を構成要素として扱っていない。

**影響**

利用者・保守者が拡張機能の現在の機能セットを README / 設計書から把握できない。実装と設計書の差分が今後さらに広がる。

**推奨対応**

- README に `Bob Workflow: テンプレートカスタマイズ Studio` の導線、生成される `.bob/template-profiles/`、`.bob/template-customizations/`、`.bob/template-readiness/` を追加する。
- `docs/README-ja.md` に Phase 4 training / UAT / template customization 関連文書へのリンクを追加する。
- `basic-design-ja.md` / `detailed-design-ja.md` に `src/template/*`、`commands/templateCommands.ts`、`TemplateCustomizationStudio*`、readiness report を追記する。

### P2-DOC-02: `taskSnapshots.includeMessages` の既定値が package と詳細設計で矛盾している

**該当箇所**

- `extensions/workflow-register/package.json`
  - `workflowRegister.taskSnapshots.includeMessages.default` は `false`。
- `extensions/workflow-register/docs/detailed-design-ja.md`
  - 設定表では `workflowRegister.taskSnapshots.includeMessages` の既定値が `true`。

**内容**

実装上は Bob chat messages を snapshot に含める設定が既定 `false` だが、詳細設計は `true` と説明している。

**影響**

復旧・診断時に message が保存されている前提で運用してしまう可能性がある。プライバシー / 情報量の観点でも重要な設定なので、ドキュメントの誤りは早めに修正したい。

**推奨対応**

- 詳細設計の既定値を `false` に修正する。
- README の task snapshot 説明にも「messages は明示設定時のみ含む」ことを明記する。

### P2-TEST-01: 単体テスト仕様書が Template Customization Studio / template command を含んでいない

**該当箇所**

- `extensions/workflow-register/docs/unit-test-spec-ja.md`
- `extensions/workflow-register/test/templateCustomizationStudio.test.js`
- `extensions/workflow-register/test/templateCommands.test.js`

**内容**

実テストには `templateCustomizationStudio.test.js` と `templateCommands.test.js` が追加されているが、単体テスト仕様書の対象範囲とテスト項目は parser / validator / engine / run state / GUI Builder などに留まり、Template Customization Studio、template validation、generator、readiness、template command の項目がない。

**影響**

仕様に対するテストの対応表を追えない。今後、実装変更時にどの仕様を守るべきかが不明確になる。

**推奨対応**

- `WR-UT-036` 以降として、少なくとも次を追加する。
  - template library listing と standard template 既定選択
  - project profile / customization validation
  - generator の `x-bob-template` と hash mismatch
  - Studio model からの preview / generate / diff
  - readiness pass / warning / fail
  - Webview の許可フィールド / 禁止フィールド
  - Webview JSON 埋め込み安全性
  - input default 型 round-trip

### P2-TEST-02: Webview panel の message handling が source regex テスト中心で、振る舞いの保証が弱い

**該当箇所**

- `extensions/workflow-register/test/templateCustomizationStudio.test.js`
  - `template customization studio panel wires preview generation and diff host messages`
  - `template customization studio panel wires validation readiness and report actions`

**内容**

Panel wiring のテストは、ソース文字列に message type や関数名が含まれるかを見る形が中心で、実際に `onDidReceiveMessage` 相当の message を流して `postMessage()` の payload や `vscode.diff` / `showTextDocument` が呼ばれることまでは検証していない。

**影響**

関数名が存在するだけでテストが通るため、message 分岐の payload 不整合、状態更新漏れ、error handling の退行を検出しにくい。

**推奨対応**

- Panel の message 処理を VS Code API から切り離した controller / handler として抽出する。
- fake webview / fake commands / fake window を使い、`previewWorkflow`、`generateWorkflow`、`showWorkflowDiff`、`checkReadiness`、`openReadinessReport` の postMessage payload と副作用を検証する。

### P3-TEST-03: 実機テスト仕様と新規 UAT 文書の接続が弱い

**該当箇所**

- `extensions/workflow-register/docs/real-machine-test-spec-ja.md`
- `docs/uat/phase4-template-customization-gui-core-uat-ja.md`

**内容**

Top-level の UAT 文書には `P4-GUI-UAT-001` から `P4-GUI-UAT-009` までがあるが、extension 側の実機テスト仕様には Template Customization Studio、template library、profile / customization、readiness report が対象として入っていない。

**影響**

UAT は存在するが、workflow-register の正式な実機テスト仕様から見つけにくい。将来の回帰確認時に Phase 4 GUI Core が漏れやすい。

**推奨対応**

- `real-machine-test-spec-ja.md` の GUI 対象に Template Customization Studio を追加する。
- `P4-GUI-UAT-*` を `WR-RT-*` から参照するか、付録として取り込む。

### P3-CI-01: 対象 commit の CI 実行結果を確認できない

**該当箇所**

- `.github/workflows/extensions-quality.yml`

**内容**

CI 定義上、`workflow-register` job は `dependency:policy`、`architecture:policy`、`source:policy`、`schema:policy`、`unused:report`、`audit:prod`、`npm test`、`package`、`package:policy` を実行する。しかし対象 commit の status / workflow run は取得できなかった。

**影響**

本レビューでは、静的確認とテストコードの存在確認までであり、実際にテストが成功していることは確認できていない。

**推奨対応**

- 対象 commit またはレビュー反映ブランチで `extensions-quality` を実行し、結果をレビュー文書または PR に紐づける。
- 少なくともローカル / CI のどちらかで次を確認する。

```powershell
cd extensions/workflow-register
npm ci
npm run compile
npm test
npm run architecture:policy
npm run source:policy
npm run schema:policy
npm run package:policy
```

## 仕様とテストの対応状況

| 仕様・期待 | 実装 / テストの存在 | 評価 |
| --- | --- | --- |
| Studio command が Command Palette から開ける | `package.json` と `extensionWithAuthoring.ts`、`templateCommands.test.js` の metadata test | 概ね OK |
| 3 タブ `Template Library` / `Customize` / `Readiness` | `templateCustomizationStudioHtml.ts`、HTML test | OK |
| `process-code-precheck` が既定選択される | `listTemplateLibrary()` の sort、Studio test | OK |
| Bazaar profile は `vcs.noAliases: true` | `buildProjectProfileFromStudioModel()`、Studio test | OK |
| guardrails / command provider / result sink type を GUI で編集しない | HTML test で該当文言の非表示を確認 | 概ね OK。ただし source / HTML 文字列確認中心 |
| unsafe path で workflow を生成しない | Studio test で `../outside` を検証 | OK。ただし symlink escape は未検証 |
| preview で生成 Markdown と diagnostics を表示 | preview model test、client / panel source test | 概ね OK。message handling の実振る舞いテストは弱い |
| diff を開く | diff preview file 作成 test、panel source test | 部分的。VS Code diff 呼び出しの振る舞い test は弱い |
| profile / customization / workflow を保存 | generate model test | OK。ただし partial write / backup 方針は未検証 |
| readiness status / score / checks / nextActions を表示 | readiness model test、HTML test | 概ね OK |
| readiness report を開く | panel source test | 部分的。実際の report open の fake VS Code test がほしい |
| input default を安全編集 | path-like input の unsafe path は検証 | 型 round-trip 未検証 |
| docs に操作手順がある | top-level training / UAT は存在 | extension README / 設計 / docs index との整合が不足 |

## 推奨対応順

1. P1 の 3 件を先に直す。
   - Webview JSON 埋め込み安全化
   - Git 既定で Bazaar prompt が混入する問題
   - input default 型 round-trip
2. `README.md`、`basic-design-ja.md`、`detailed-design-ja.md`、`unit-test-spec-ja.md`、`real-machine-test-spec-ja.md` を Phase 4 GUI Core に合わせて更新する。
3. Webview message handling と生成時 failure path のテストを追加する。
4. symlink escape / atomic write / backup 方針を共通 helper 化して、template command と Studio generation の両方へ適用する。
5. CI またはローカルで `extensions-quality` 相当を実行し、結果をレビュー追跡に残す。

## 結論

現状の実装は、Phase 4 GUI Core の主要シナリオをかなりの範囲で満たしている。特に validation / generation / readiness を Core 側に寄せ、GUI を薄い操作層にしようとしている点は維持したい。

ただし、Webview 安全性、型保持、既定 prompt の誤混入は、利用者が生成物を信頼するうえで重要な問題である。ドキュメントとテスト仕様も実装に追従させることで、今後の Template Customization Studio 拡張時に仕様逸脱を検出しやすくなる。
