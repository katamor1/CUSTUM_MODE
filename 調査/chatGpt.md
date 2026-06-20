結論：**「既存モードを継承して差分だけ書く」設定は、公式ドキュメント上はありません。**
つまり、`extends: code` や `baseMode: code` のように「Codeモードのまま、コマンドだけ制限」という書き方はできません。

やり方は次の3択です。

| やりたいこと                        | 推奨方法                                         | 既存モードの動作は保てる？ | 制限の強さ |
| ----------------------------- | -------------------------------------------- | ------------: | ----: |
| 既存Code/Planの挙動はそのまま、運用ルールだけ追加 | `.bob/rules-code/` などにルールを書く                 |             ◎ |    弱い |
| 既存Code/Planを同じ `slug` で上書き    | `.bob/custom_modes.yaml` に `slug: code` 等を書く |        △ 近似のみ |    強い |
| 安全な派生モードを別名で作る                | `slug: safe-code` などで新規作成                    |     ◎ 元モードは残る |    強い |

BobのCustom modesは、`slug`、`name`、`roleDefinition`、`whenToUse`、`groups`、`customInstructions` などを定義する方式です。既定モードを上書きする場合は、同じ `slug` のカスタムモードを作ります。プロジェクト設定はグローバル設定より優先され、さらにデフォルトより優先されます。([IBM Bob][1])

---

## 一番重要：既存動作のままにしたいなら `custom_modes.yaml` で上書きしない

既存のCodeモードのまま、少しだけルールを足したいなら、**`custom_modes.yaml` ではなく `.bob/rules-code/` を使う**のが一番安全です。

Bob公式では、モード別ルールとして `.bob/rules-{mode-slug}/` または `.bobrules-{mode-slug}` を使えると説明されています。たとえば `code` モードなら `.bob/rules-code/`、`plan` モードなら `.bob/rules-plan/` です。これらは、そのモードを使ったときに自動ロードされます。([IBM Bob][1])

構成例：

```text
project-root/
  .bob/
    rules-code/
      01-command-policy.md
      02-skill-policy.md
    rules-plan/
      01-design-policy.md
```

`.bob/rules-code/01-command-policy.md`：

```md
# Code mode command policy

Code modeでは、原則として以下のコマンドのみ使用する。

## 許可するコマンド

- git status
- git diff
- git diff --stat
- git log
- rg
- cl
- msbuild
- ctest

## 禁止するコマンド

以下はユーザーが明示的に許可しない限り実行しない。

- del
- erase
- rmdir
- Remove-Item
- git clean
- git reset --hard
- git push
- npm publish
- curl
- Invoke-WebRequest
- powershell -EncodedCommand

## 判断ルール

許可リストにないコマンドを使いたい場合は、実行前に目的、対象、リスクを説明して確認する。
```

この方法なら、**Codeモード自体は既存のまま**です。
ただしこれは「Bobへの指示」なので、ツール権限レベルの強制ではありません。強制したいなら後述の `groups` 制御やAuto-approve制御が必要です。

---

## コマンド制御は2種類ある

### 1. `groups` で `command` を許可/禁止する

カスタムモードでは、利用可能ツールグループとして `read`、`edit`、`browser`、`command`、`mcp`、`skill` を指定できます。`command` を入れるとターミナルコマンド実行が可能、外すと不可です。([IBM Bob][1])

ただし、**`groups` では「git statusだけ許可、Remove-Itemは禁止」のようなコマンド単位の制御はできません。**
できるのは基本的に、

```yaml
groups:
  - read
  - edit
  - command
```

または、

```yaml
groups:
  - read
  - edit
```

のような **command全体のON/OFF** です。

---

### 2. Auto-approveで「自動実行できるコマンド」を絞る

BobのAuto-approveには `Execute` があり、これを有効にするとコマンド実行を確認なしで進められます。ただしExecuteは2段階で、まずExecute全体を有効化し、そのうえで個別コマンドを許可リストに追加する仕組みです。新しいコマンドを実行しようとすると確認が出て、そのパターンを許可リストに追加できます。([IBM Bob][2])

つまり、

```text
command groupあり
+ Auto-approve Executeあり
+ 許可済みコマンドだけ自動実行
```

という運用が現実的です。

ただしこれは「自動承認」の制御です。
**許可リスト外のコマンドを絶対に使えなくする設定**というより、許可リスト外は確認を求める、という理解が近いです。

---

## Skill制御も「全体ON/OFF」と「運用ルール」の組み合わせ

Custom modesの利用可能ツールグループには `skill` が含まれています。([IBM Bob][1])
一方で、Skillsページでは「Skills are only available in Advanced mode」とも説明されています。([IBM Bob][3])

ここはドキュメント上やや悩ましいです。実際のBobバージョンで `custom_modes.yaml` の `groups: - skill` が有効なら、カスタムモードでもSkillを使える可能性があります。もし動かない場合は、公式のSkillsページどおりAdvanced mode限定と考えるのが安全です。

重要なのは、**公式ドキュメント上、`groups` で “特定のSkillだけ許可” する書式は見当たりません。**
できるのは基本的に、

```yaml
groups:
  - skill
```

でSkill全体を許可するか、

```yaml
groups:
  - read
  - edit
  - command
```

のように `skill` を書かずSkill全体を外すか、です。

特定Skillだけ使わせたい場合は、現実的には `.bob/rules-*` や `customInstructions` で制御します。

例：

```md
# Skill policy

このモードでは以下のSkillのみ使用する。

- basic-design
- detail-design
- test-design

以下のSkillは使用しない。

- experimental-refactor
- mass-edit
- release-operation

許可されていないSkillが必要だと判断した場合は、Skillを起動せず、理由と候補を説明してユーザー確認を取る。
```

---

## 「既存のCodeモードのまま」を近似するYAML

既存Codeモードは、公式上は `read`, `edit`, `command` を持ち、一般的なコーディング作業向けです。([IBM Bob][4])
これを上書きで近似するなら、最低限こうです。

```yaml
customModes:
  - slug: code
    name: Code
    roleDefinition: >
      You are Bob, a highly skilled software engineer with extensive knowledge
      in many programming languages, frameworks, design patterns, and best practices.
    whenToUse: >
      Use for general purpose coding tasks, including implementing features,
      fixing bugs, modifying code, refactoring, and debugging.
    customInstructions: >
      Preserve the behavior of the built-in Code mode as much as possible.
      Follow AGENTS.md and .bob/rules-code when present.
    groups:
      - read
      - edit
      - command
```

ただし、これは**完全な既存Codeモードではなく、公開されている説明を元にした再定義**です。Bob内部のデフォルトプロンプトや細かい挙動まで完全一致する保証はありません。ここが落とし穴です。

---

## Codeモードのまま、編集対象だけ絞る例

`edit` は `fileRegex` で編集対象ファイルを制限できます。公式例でも、`edit` に `fileRegex` を付ける形が示されています。([IBM Bob][1])

```yaml
customModes:
  - slug: code
    name: Code - C Maintenance
    roleDefinition: >
      You are Bob, a highly skilled software engineer with extensive knowledge
      in many programming languages, frameworks, design patterns, and best practices.
    whenToUse: >
      Use for implementation, bug fixes, refactoring, and unit test changes.
    customInstructions: >
      Preserve the behavior of the built-in Code mode as much as possible.
      Follow AGENTS.md and .bob/rules-code.
      Before running destructive commands, ask for confirmation.
    groups:
      - read
      - - edit
        - fileRegex: ^(src|include|tests|tools)/.*\.(c|h|cpp|hpp|md|txt)$
          description: C/C++ source, headers, tests, tools, markdown, and text files only
      - command
```

これは「Codeモード相当 + 編集対象制限」です。
ただし、これも既存Codeの継承ではなく上書きです。

---

## Planモードのまま、Markdown編集だけ維持する例

既存Planモードは `read`, Markdown限定 `edit`, `browser`, `mcp` を持つと説明されています。([IBM Bob][4])
上書きで近似するならこうです。

```yaml
customModes:
  - slug: plan
    name: Plan
    roleDefinition: >
      You are Bob, an experienced technical leader who is inquisitive and an
      excellent planner. Your goal is to gather information and get context to
      create a detailed plan for accomplishing the user's task, which the user
      will review and approve before they switch into another mode to implement
      the solution.
    whenToUse: >
      Use for planning and designing before implementation, architecture
      discussion, task breakdown, and technical planning.
    customInstructions: >
      Preserve the behavior of the built-in Plan mode as much as possible.
      Do not implement source-code changes in this mode.
      Follow AGENTS.md and .bob/rules-plan.
    groups:
      - read
      - - edit
        - fileRegex: \.(md|mdx|txt)$
          description: Markdown and text planning documents only
      - browser
      - mcp
```

これも完全継承ではなく、公開仕様からの再定義です。

---

## Advancedを安全寄りにする例

既存Advancedは「Advanced version of Code mode」で、公式表では全ツールグループ、具体的には `read`, `edit`, `command`, `mcp` と説明されています。([IBM Bob][4])
Skillを使いたい場合は、あなたのBobで `skill` グループが有効か確認しつつ、こういうカスタムモードを別名で作る方が安全です。

```yaml
customModes:
  - slug: advanced-safe
    name: Advanced Safe
    roleDefinition: >
      You are Bob, a highly skilled software engineer with extensive knowledge
      in many programming languages, frameworks, design patterns, and best practices.
    whenToUse: >
      Use for advanced coding tasks that may require MCP tools or approved project skills.
    customInstructions: >
      Preserve the behavior of the built-in Advanced mode as much as possible,
      but follow the command and skill restrictions in AGENTS.md and .bob/rules-advanced-safe.
      Use only approved project skills.
      Do not run destructive commands without explicit user approval.
    groups:
      - read
      - - edit
        - fileRegex: ^(src|include|tests|docs|tools)/.*\.(c|h|cpp|hpp|md|txt|json|yaml|yml)$
          description: Approved project files only
      - command
      - mcp
      - skill
```

既存Advancedを `slug: advanced` で上書きするより、まず `advanced-safe` のように別モードで作るのがおすすめです。逃げ道を残す。これ大事です。

---

## 特定コマンドだけ使わせたい場合の現実解

たとえば、Bobに以下だけ許可したいとします。

```text
git status
git diff
rg
msbuild
ctest
```

この場合、私はこうします。

### `.bob/custom_modes.yaml`

```yaml
customModes:
  - slug: code-safe
    name: Code Safe
    roleDefinition: >
      You are Bob, a highly skilled software engineer with extensive knowledge
      in many programming languages, frameworks, design patterns, and best practices.
    whenToUse: >
      Use for safe implementation, refactoring, and testing in this repository.
    customInstructions: >
      Behave like the built-in Code mode as much as possible.
      Follow .bob/rules-code-safe.
    groups:
      - read
      - - edit
        - fileRegex: ^(src|include|tests|docs|tools)/.*\.(c|h|cpp|hpp|md|txt|json|yaml|yml)$
          description: Approved project files only
      - command
```

### `.bob/rules-code-safe/01-command-policy.md`

```md
# Command policy

このモードで使用してよいコマンドは以下のみ。

- git status
- git diff
- git diff --stat
- rg
- msbuild
- ctest

以下は禁止。

- del
- erase
- rmdir
- Remove-Item
- git clean
- git reset --hard
- git push
- curl
- Invoke-WebRequest
- powershell -EncodedCommand
- cmd /c
- bash -c

許可リストにないコマンドが必要な場合は、実行せず、理由と代替案を提示してユーザー確認を取る。
```

### Auto-approve

Auto-approveの `Execute` はONにして、実際にBobが確認してきたときに `git status`、`git diff`、`rg`、`msbuild`、`ctest` だけを許可パターンへ追加します。BobのExecute auto-approvalは、Execute全体の承認と個別コマンドパターン承認の2段階です。([IBM Bob][2])

これで、

```text
許可コマンド → 自動実行
未許可コマンド → 確認が出る
危険コマンド → ルール上も禁止
```

という運用になります。

---

## 特定Skillだけ使わせたい場合の現実解

たとえば、設計系だけ許可したい場合。

```text
basic-design
detail-design
test-design
```

### `.bob/custom_modes.yaml`

```yaml
customModes:
  - slug: design-advanced
    name: Design Advanced
    roleDefinition: >
      You are a technical design lead for a Windows C/C++ machine-control system.
    whenToUse: >
      Use for requirements analysis, impact analysis, basic design,
      detailed design, and test design.
    customInstructions: >
      Behave like the built-in Advanced mode where possible, but use only
      approved design skills listed in .bob/rules-design-advanced.
    groups:
      - read
      - - edit
        - fileRegex: ^(docs|design|tests|\.bob)/.*\.(md|txt|json|yaml|yml)$
          description: Design, test, and Bob configuration documents only
      - command
      - mcp
      - skill
```

### `.bob/rules-design-advanced/01-skill-policy.md`

```md
# Skill policy

このモードで使用してよいSkillは以下のみ。

- basic-design
- detail-design
- test-design

その他のSkillは使用しない。

複数Skillが該当する場合は、以下の順で使用する。

1. basic-design
2. detail-design
3. test-design

許可されていないSkillが必要に見える場合は、Skillを起動せず、理由を説明してユーザー確認を取る。
```

ただし繰り返しですが、これは**Skill単位のハード制限ではなく、指示による制御**です。
ハードに止めたいなら、危険なSkillを `.bob/skills/` から置かない、別ディレクトリへ退避する、または `description` を無効化するほうが堅いです。BobはSkillの `description` を見て起動判断し、descriptionがないSkillは無視されます。([IBM Bob][3])

---

## では「既存の動作のまま」にするには何を書けばいいか？

一番正確な答えはこれです。

```text
何も書かない。
```

既存モードを完全に保ちたいなら、`custom_modes.yaml` で同じ `slug` を上書きしないことです。

代わりに、

```text
.bob/rules-code/
.bob/rules-plan/
.bob/rules-advanced/
AGENTS.md
Auto-approveのExecute許可リスト
```

で制御します。

`custom_modes.yaml` に同じ `slug` を書いた瞬間、それは「差分適用」ではなく「上書き」です。公式ドキュメントも、既定モードを上書きするには同じslugのモード設定を追加する、と説明しています。([IBM Bob][1])

---

## おすすめ方針

あなたの目的なら、段階的にはこうです。

```text
第1段階:
  既存Code/Plan/Advancedは上書きしない
  .bob/rules-code/ と .bob/rules-plan/ にコマンド・Skill運用ルールを書く

第2段階:
  Auto-approve Executeで、自動実行してよいコマンドだけ許可する

第3段階:
  それでも危ない場合だけ、code-safe / advanced-safe など別slugの安全モードを作る

第4段階:
  チーム全体で安定してから、必要なら slug: code などで既存モードを上書きする
```

個人的には、いきなり既存 `code` を上書きするのはやめた方がいいです。
Bobの「いつものCodeっぽさ」を残したいなら、**既存モード + rules + Auto-approve制御**が一番きれいです。

[1]: https://bob.ibm.com/docs/ide/configuration/custom-modes "Custom modes | Docs | IBM Bob"
[2]: https://bob.ibm.com/docs/ide/features/auto-approving-actions "Auto-approve | Docs | IBM Bob"
[3]: https://bob.ibm.com/docs/ide/features/skills "Skills | Docs | IBM Bob"
[4]: https://bob.ibm.com/docs/ide/features/modes "Modes | Docs | IBM Bob"
