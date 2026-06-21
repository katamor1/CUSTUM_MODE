# IBM Bob Code 3.26.6 プロジェクト上書きベースライン

## 結論

このプロジェクトでは、`.bob/custom_modes.yaml` に組み込み `code` mode と同じ内容を完全定義し、同一 slug で上書きする。

現在のベースラインは、同梱された IBM Bob Code 3.26.6 の実装に対して以下を満たす。

- `slug` は `code` のまま
- `name`、`roleDefinition`、`whenToUse`、`description` は組み込み値と一致
- `groups` は組み込み値と同じ `read`、`edit`、`command` の順序
- 組み込み Code に存在しない `customInstructions` は追加しない
- `.bob/rules-code/` は置かない
- IBM 独自の Code 用軽量プロンプト経路を維持

検証コマンド:

```powershell
node scripts\bob-code-baseline.mjs
node --test tests\bob-code-baseline.test.mjs
```

2026-06-21 の実行結果:

```text
PASS: Bob Code version 3.26.6
PASS: project code mode matches the built-in baseline
PASS: .bob/rules-code is absent or empty
PASS: optimized Code prompt branch is present
```

```text
tests 38
pass 38
fail 0
```

## 対象配布物

`org/bob-code/package.json`:

| 項目 | 値 |
|---|---|
| package | `bob-code` |
| version | `3.26.6` |
| bobVersion | `1.0.3` |
| Node | `20.19.2` |
| VS Code | `^1.84.0` |

調査時の SHA-256:

| ファイル | SHA-256 |
|---|---|
| `org/bob-code/package.json` | `58583F7CA049EA35956160728C0AC4F5376EEC442F93D09067758409A7C82CD3` |
| `org/bob-code/dist/extension.js` | `C0B071BA8AED25C70E5C14940E6CA61817A8DD026369D2B9483FF99D792C493E` |
| `org/bob-code/dist/extension.js.map` | `69C6FC2AAC6C3B42D0FCEB15F58EF9E73654B21DA2ED351E302303D0B3C225F4` |
| `.bob/custom_modes.yaml` | `94D45604A0D7687705F23DE116AA230B70A5322438DC88B3BA82E0B2749B46C3` |

Bob を更新した場合は、古いハッシュを新しい配布物へ流用せず、verifier が示す版不一致を起点に再調査する。

## 確定した組み込み Code 定義

```yaml
customModes:
  - slug: code
    name: "💻 Code"
    roleDefinition: "You are Bob, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices."
    whenToUse: "Use this mode when you need to write, modify, or refactor code. Ideal for implementing features, fixing bugs, creating new files, or making code improvements across any programming language or framework. Does not support MCP or Browser tools."
    description: "Write and modify code"
    groups:
      - read
      - edit
      - command
```

`source: project` は YAML に書かない。Bob が project file の読込時に付与する実行時メタデータであり、mode の定義値ではない。

## 実装根拠

同梱 source map を使い、`dist/extension.js` を元の TypeScript 位置へ対応付けた。

| 調査対象 | 元ソース位置 | bundle 位置 |
|---|---|---|
| 組み込み mode 定義 | `packages/types/src/mode.ts:153` | `extension.js:4:88183` |
| custom mode 優先 lookup | `shared/modes.ts:70` | `extension.js:810:2872` |
| 同一 slug の置換 | `shared/modes.ts:89` | `extension.js:810:3046` |
| prompt override の適用 | `shared/modes.ts:328` | `extension.js:810:4979` |
| mode 別 rules の読込 | `core/prompts/sections/custom-instructions.ts:265` | `extension.js:789:22` |
| `code` 専用プロンプト分岐 | `core/prompts/system.ts:137` | `extension.js:5564:173` |
| project/global の統合 | `core/config/CustomModesManager.ts:259` | `extension.js:6130:355` |
| custom mode の読込 | `core/config/CustomModesManager.ts:402` | `extension.js:6130:2564` |
| IBM 軽量プロンプト本体 | `ibm/core/prompts/sections/ibm-prompt.ts:18` | `extension.js:5306:521` |
| Settings の prompt 保存 | `core/webview/webviewMessageHandler.ts:1688` | `extension.js:6076:23125` |

### 優先順位

実行時の選択順序は次のとおり。

```text
同一 slug の project custom mode
  > 同一 slug の global custom mode
  > 組み込み mode
```

project と global の mode は field 単位で merge されない。同じ `slug` がある場合、mode object 全体が上位定義へ置き換わる。

したがって、次のような部分定義は使用しない。

```yaml
# 不可: 欠落 field が組み込み値から補完されるわけではない
customModes:
  - slug: code
    customInstructions: "追加ルール"
```

必須 field を満たさず schema error になるか、記載した mode 全体で置換される。

### Code の性能経路

Bob Code 3.26.6 は一般 mode と `code` で system prompt の生成経路を分けている。

`code` の場合、`core/prompts/system.ts:137` から IBM の cost-effective prompt へ分岐する。判定は mode object の由来ではなく、最終的な slug が文字列 `code` かどうかで行われる。

このため project override でも以下を守れば、この経路は残る。

1. `slug: code` を維持する
2. `groups: [read, edit, command]` を維持する
3. `.bob/system-prompt-code` で system prompt 全体を上書きしない

verifier は Bob 3.26.6 の以下の構造を実配布物から確認する。

- 組み込み mode 配列が一意
- `code` mode が一意
- IBM prompt builder `oju` が一意で正規の parameter list を持つ
- 最初の到達可能な direct `code` 分岐が正規の Code prompt template を返す

## 「完全模倣」の範囲

自動検証で証明している項目:

- project YAML と組み込み Code の公開 mode field が一致
- tool group と順序が一致
- 対象版が Bob Code 3.26.6
- `.bob/rules-code/` が存在しないか空
- Code 専用 cost-effective prompt 経路が同梱実装に存在
- verifier が executable bundle expression を評価せず、data literal として解析

プロジェクトから自動検証できない項目:

- VS Code extension の global state に保存された `customModePrompts`

Bob の Settings 画面で組み込み Code の Role Definition、When to Use、Description、Custom Instructions を過去に編集している場合、その global prompt override が project mode の同名 field より後から適用される。

ゼロ差分試験前に、Bob Settings の Modes から Code の変更済み field を Reset しておく。これは project file ではなく extension global state のため、このリポジトリの verifier からは削除できない。

また、`.bob/system-prompt-code` が存在すると mode prompt 全体の別経路になるため、完全模倣の対象外となる。現状このファイルは作成していない。

## verifier の役割

`scripts/bob-code-baseline.mjs` は外部依存を使用しない。

- bundle 内の組み込み mode data literal を実行せず解析
- 文字列・comment・property 内の偽 `Mxe` を除外
- 複数候補や duplicate slug を曖昧なまま採用せず失敗
- project YAML を制約付き parser で解析
- mode field と group 順序を比較
- Code fast path を Bob 3.26.6 の正規構造と照合
- 非空の `.bob/rules-code/` をゼロ差分違反として検出

対象版を意図的に `3.26.6` へ固定している。Bob を更新したのに検証を通すため version check を緩めてはならない。

## 改造を開始する場合

現在はゼロ差分ベースラインであり、改造はまだ入っていない。

最初の改造は `.bob/custom_modes.yaml` の既定 field を書き換えるのではなく、次のように mode 別 rules へ分離する。

```text
.bob/
  custom_modes.yaml
  rules-code/
    10-project-policy.md
```

ただし `rules-code` に内容を追加した時点で、完全模倣ではなく意図的な差分になる。現在の verifier が `.bob/rules-code must be absent or empty` で失敗するのは正常である。

改造時の原則:

1. `.bob/custom_modes.yaml` は抽出済みの既定 mode 定義として維持する
2. 変更理由と期待動作を rules file ごとに分ける
3. 一度に一つのルールだけ追加し、同じ課題で組み込み Code と比較する
4. tool 権限を変更する場合だけ `groups` を変更し、性能・能力差として明示する
5. Bob 更新時は一度 rules を外して exact baseline を再作成する

## 元調査資料との差分

`調査/chatGpt.md` の「同じ slug の custom mode は完全継承ではなく上書き」という主張は実装と一致する。

一方、Bob Code 3.26.6 では `slug: code` が IBM 固有の軽量 prompt 分岐を維持することを同梱実装から確認できた。したがって、公開 field の完全複製と同一 slug の組合せは、単なる公開説明の近似より強いベースラインとなる。

