# Bob 2.0.0 Workflow Discovery Analysis

調査日: 2026-06-27  
対象: `bob2/bob-code` の `Start Workflow` UI、組み込み workflow の表示条件、任意 workflow 追加可否

## 0. 追加調査後の修正結論

2026-06-27 追加更新: `IBM.bob-code` の extension exports には `registerSource` があり、`bob2/bob-code/dist/extension.js` の実装から、戻り source の `registerWorkflow(workflow)` を使えば Start Workflow registry へ登録できることを確認した。したがって、下記の「公開 API として未確認」という評価は、初回調査時点の保守的な結論であり、現在の実験ブランチでは `registerSource(id, name) -> source.registerWorkflow(workflow)` を使う方針に更新している。実機ログでも `[source:bob-bazaar-review] Bazaar Project Rule Review workflow registered` を確認した。ただし Bob 側の初期化順と UI の再取得タイミングに左右されるため、companion extension は startup で silent 登録し、遅延 force reconciliation と手動 force command を持つ。

前回は `.bob/workflows/*.md` を workspace に置けば任意 workflow が表示される、という仮説を置いた。今回、実機で組み込み workflow だけが表示され、任意 workflow は追加されないことを受けて再調査した結果、この仮説は弱い。

現時点の結論は次の通り。

1. `Start Workflow` 画面は、任意 Markdown ファイルを列挙する UI ではなく、Bob 本体または公式 add-on/source が内部 registry に登録した workflow を表示する UI と見るのが妥当。
2. `bob2/bob-code` の `package.json` や公開 docs には、`contributes.workflows` や `.bob/workflows/*.md` のような公開された workflow contribution point は確認できない。
3. Bob 公式 docs が公開している「任意の再利用 workflow」の仕組みは **Skills** であり、ファイル形式は `.bob/skills/<skill-dir>/SKILL.md` + YAML front matter である。
4. 任意 workflow を Bob に認識させたい場合は、まず Skill として作る。`Start Workflow` のカードとして表示させるには、Bob 内部の workflow registry に登録する必要があるが、これは公開 API として確認できない。

つまり、実用上の推奨は次。

```text
任意 workflow を追加したい
  -> .bob/workflows/*.md ではなく、.bob/skills/<name>/SKILL.md にする

Start Workflow 画面にカードとして出したい
  -> Bob 本体 / 公式 add-on / 内部 source registry 登録が必要。第三者拡張から安定利用できる公開 API は未確認
```

## 1. 画面を出している入口

`bob2/bob-code/package.json` には `bob-code.task.workflow` command が定義されており、表示名は localization 上 `Start Workflow` である。

既存調査メモでも、command 一覧に `bob-code.task.workflow` が `Start Workflow` として整理されている。

```text
bob-code.task.workflow -> Start Workflow
```

また menus では Chat view の title 領域に workflow command が出る構成で、command palette でも workflow の表示制御がある。

重要なのは、menu の `when` 条件に `bob-code.hasWorkflows` が使われていること。つまり Bob extension host 側は workflow の有無を VSCode context key として管理している。

```text
bob-code.hasWorkflows
bob-code.hasRequestsWaiting
bob-code.commitGenerationInProgress
```

## 2. 組み込み workflow が表示される理由

実機では次の 2 件が表示された。

- `Create Pull Request`
- `レビューパネルを開く`

これは公式 docs の機能と一致する。

### 2.1 Create Pull Request

IBM Bob docs の Pull requests 機能では、Bob が branch changes / commit history / branch name を解析し、PR title / description を生成し、ユーザーが確認・編集したうえで PR を作る流れが説明されている。起動方法として Source Control panel、command palette、`/create-pr` が挙げられている。

このため `Create Pull Request` は、workspace の任意ファイルから検出されたものではなく、Bob 本体の PR workflow source が登録している workflow と見るのが自然。

### 2.2 レビューパネルを開く

IBM Bob docs の Code reviews 機能では、built-in Review workflow が Bob Review panel を開き、branch diff を分析し、Bob Findings panel に findings を出すと説明されている。起動方法は `/review` command または Review panel icon と説明されている。

既存 ZIP 分析でも、review source は Code Review finding source、review tool、review workflow を登録し、`review-flow-enabled` feature flag によって enable/disable されると整理している。

このため `レビューパネルを開く` も、Bob 本体の review source が registry に登録している workflow と見るのが自然。

## 3. Bob 内部で workflow がどう扱われているか

ZIP 実体を調査した既存メモでは、Bob は `SourceRegistry` 相当の singleton を持ち、そこに次の source を登録する構造と整理されている。

- modes
- tools
- findings
- workflows
- groups
- skills
- mcpHub
- workspaces

同メモでは、registry に `registerWorkflow(sourceId, workflow)` 相当の拡張点があると整理されている。

また task manager 側には `openTask({ useWorkspace, location, workflow, defaultMode, onReady })` が確認されており、workflow は単なる menu item ではなく、task 起動時の入力として渡される。

したがって picker は概ね次の流れで動いていると考えられる。

```text
bob-code.task.workflow
  -> workflow registry / source から利用可能 workflow を取得
  -> QuickPick / webview list に workflow items を設定
  -> 選択された workflow を task manager.openTask({ workflow }) に渡す
```

## 4. `.bob/workflows/*.md` が表示されない理由

### 4.1 公式 docs に `.bob/workflows` の公開仕様が見当たらない

IBM Bob docs の Skills ページには `.bob/skills` の仕様が明記されている。一方、任意 workflow を `.bob/workflows/*.md` として読み込む仕様は、公開 docs 上では確認できない。

Changelog には `Nested workflows` や Premium Package の workflows は出てくるが、これは Bob 本体または premium package が提供する workflow の説明であり、workspace file discovery の仕様とは読めない。

### 4.2 companion extension の template は Bob 本体の discovery ではない

`extensions/bob-bazaar-review/templates/.bob/workflows/bazaar-project-rule-review.md` は repository 内に存在する。

ただしこれは `bob-bazaar-review` companion extension が project template として配るファイルであり、Bob 本体が自動探索する公開仕様とは限らない。

`bobWorkspaceInit.ts` でも `.bob/workflows/bazaar-project-rule-review.md` は `REQUIRED_FILES` に含まれるが、これは Bob 本体ではなく companion extension 側の workspace 初期化チェックである。

したがって `.bob/workflows/*.md` を置いても `Start Workflow` に出ない、という実機結果と矛盾しない。

## 5. Skill として任意 workflow を追加する制約

公式 docs で確認できる Skill の制約は次。

### 5.1 配置場所

project skill:

```text
<project-root>/.bob/skills/<skill-dir>/SKILL.md
```

global skill:

```text
~/.bob/skills/<skill-dir>/SKILL.md
```

同名 skill が project と global の両方にある場合は、project-level skill が優先される。

### 5.2 `SKILL.md` の書式

`SKILL.md` は YAML front matter + instruction body で構成する。

```md
---
name: project-rule-review
description: Review Bazaar revisions against project-specific rules and output normalized JSON findings
---

When reviewing a Bazaar revision:

<Steps>
<Step>
Load the project checklist from `.bob/review/checklist.json`.
</Step>
<Step>
Inspect only files and symbols related to the requested revision or range.
</Step>
<Step>
Return normalized review JSON first, then a Markdown summary.
</Step>
</Steps>
```

必須 field:

- `name`
- `description`

特に `description` は重要。Bob は description を見て skill をいつ使うか判断し、description が無い skill は ignored になる。

### 5.3 supporting files

`SKILL.md` と同じ directory に、checklist、template、style guide、script、reference doc などの supporting files を置ける。

例:

```text
.bob/skills/project-rule-review/
  SKILL.md
  checklist.md
  severity-guide.md
  templates/
    review-output.md
```

Skill が activate されると、Bob は skill instructions と supporting files を参照できる。

### 5.4 activation

Bob はユーザー request と skill description を見て、必要な skill を自動判定する。Skill は conversation ごとに一度だけ load される。

そのため、任意 workflow を skill として安定起動したい場合は、ユーザー指示に skill name / description と一致する言葉を含めるのがよい。

例:

```text
project-rule-review skill を使って Bazaar revision 1234 をレビューしてください。
```

また docs 上では skills は Advanced mode のみ利用可能と記載されている。ただし Bob 2.0.0 changelog では既定 mode が Plan / Agent / Ask に整理され、Advanced / Orchestrator capabilities が defaults に折り込まれたとも説明されているため、実機では Settings の Skills tab で読み込まれているか確認するのが安全。

## 6. 任意 workflow を追加したい場合の実装方針

### 方針 A: Skill として実装する

最も安全で、公式 docs に沿う方式。

```text
<project-root>/
  .bob/
    skills/
      project-rule-review/
        SKILL.md
        checklist.md
```

メリット:

- 公開 docs に仕様がある。
- project / global の両方に置ける。
- Settings の Skills tab で読み込み確認できる。
- supporting files を同梱できる。

デメリット:

- `Start Workflow` のカードには出ない可能性が高い。
- 起動は chat prompt、skill auto activation、または mode instruction 経由になる。

### 方針 B: Custom mode + Skill で workflow 起動を安定化する

`.bob/custom_modes.yaml` に reviewer mode を定義し、`customInstructions` で skill 使用を明示する。

既存 template の `custom_modes.yaml` もこの考え方に近く、`Use the project-review-checklist skill.` と明示している。

### 方針 C: companion extension の command で Bob に投入する

`Start Workflow` に出すことにこだわらないなら、companion extension 側で VSCode command を作り、次を行う。

1. Bazaar revision / range などを入力させる。
2. review packet / prompt を生成する。
3. `bob-code.addToContext` や clipboard 経由で Bob chat に投入する。

既存 `bob-bazaar-review` はこの方式を採っている。

### 方針 D: Start Workflow にカードとして出す

現在の実験ブランチでは、`IBM.bob-code` の extension exports にある `registerSource(id, name)` と、戻り source の `registerWorkflow(workflow)` を使う。

注意点:

- workflow registry は Bob bundle 内部の source registry なので、`contributes.workflows` のような manifest-only contribution point ではない。
- `source.registerWorkflow(workflow)` を使う必要がある。source の内部 `register.workflow` を直接呼ぶと source `_parts` ownership を通らず、`entryIsEnabled(workflow.id)` で落ちる可能性がある。
- startup 直後は Bob 自身の git-dependent source 初期化や webview の workflow 再取得より早く companion extension が起動する場合があるため、silent 登録、遅延 force reconciliation、手動 force command を併用する。
- Bob 更新で API shape が変わる可能性は残るため、`Bob Bazaar: Inspect Bob Workflow API` と Bob log の `[source:bob-bazaar-review]` 行で確認する。

## 7. 実機での確認手順

1. `.bob/skills/<skill-dir>/SKILL.md` を作る。
2. front matter に `name` と `description` を入れる。
3. VSCode / Bob を reload する。
4. Bob Settings -> Skills tab で skill が見えるか確認する。
5. Chat で `Use <skill-name> skill ...` のように明示起動する。
6. `Start Workflow` には出ない前提で確認する。

## 8. 参考にした repository 内ファイル

- `bob2/bob-code/package.json`
  - `bob-code.task.workflow` command と `bob-code.hasWorkflows` 条件を確認。
- `docs/bob-dedicated-extension-foundation-analysis.md`
  - manifest / command / menu / context key の既存分析。
- `docs/bob-code-zip-implementation-analysis.md`
  - source registry、task manager、review workflow、feature flag の既存分析。
- `extensions/bob-bazaar-review/templates/.bob/README.md`
  - companion extension template に `.bob/workflows` が含まれていることを確認。
- `extensions/bob-bazaar-review/src/bobWorkspaceInit.ts`
  - `.bob/workflows/bazaar-project-rule-review.md` を companion extension 側 required file として扱うことを確認。
- `extensions/bob-bazaar-review/templates/.bob/custom_modes.yaml`
  - custom mode から skill を使う設計を確認。

## 9. 参考にした IBM Bob docs

- IBM Bob Docs: Skills
  - `.bob/skills/<folder>/SKILL.md`
  - YAML front matter
  - `name` / `description` required
  - supporting files
  - project / global skill locations
- IBM Bob Docs: Changelog 2.0.0
  - Review workflow
  - Skills settings tab
  - Premium Package workflows
  - Nested workflows
- IBM Bob Docs: Pull requests
  - built-in PR generation flow
- IBM Bob Docs: Code reviews
  - built-in Review workflow / Review panel / Findings panel
