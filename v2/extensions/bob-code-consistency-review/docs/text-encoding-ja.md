# code-consistency-review の文字コード方針

`bob-code-consistency-review` は、既存 C / C++ 製品や複数言語リポジトリで UTF-8 と Shift-JIS / CP932 系テキストが混在することを前提に、前処理で読み込むテキストを `bobCodeConsistency.textEncoding` に従って decode します。

## 設定

```json
{
  "bobCodeConsistency.textEncoding": "auto"
}
```

指定できる値は次の通りです。

| 値 | 意味 |
| --- | --- |
| `auto` | UTF-8 を優先し、置換文字が出る場合に Shift-JIS 系へ fallback します。 |
| `utf8` | UTF-8 として読みます。 |
| `shift_jis` | Shift-JIS として読みます。 |
| `cp932` | Shift-JIS 系として扱います。 |
| `windows-31j` | Shift-JIS 系として扱います。 |

## 対象

この設定は、前処理で読み込む次のテキストに適用されます。

- `review-input.yaml`
- Markdown 文書: `.md`, `.markdown`
- C / C++ と複数言語ソース: `.c`, `.cc`, `.cpp`, `.cxx`, `.h`, `.hh`, `.hpp`, `.hxx`, `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.cs`, `.java`, `.go`, `.rs`, `.sh`, `.sql`, `.json`, `.yaml`, `.yml`, `.txt`
- Git 差分 stdout: `git diff --find-renames --name-status`, `git diff --find-renames --numstat`, `git diff --find-renames --unified=80`
- Bazaar 差分 stdout: `bzr --no-aliases diff -r base..head`
- `diffFixturePath` で指定した JSON fixture

`.docx` と `.xlsx` は Office file としてライブラリが読み込むため、この設定による byte-level decode の対象ではありません。

## 推奨運用

通常は `auto` のままで構いません。

```json
{
  "bobCodeConsistency.textEncoding": "auto"
}
```

対象リポジトリ全体が Shift-JIS / CP932 中心で、auto 判定で文字化けが残る場合は、明示的に `cp932` または `shift_jis` を指定してください。

```json
{
  "bobCodeConsistency.textEncoding": "cp932"
}
```

## workflow option からの指定

Command Palette では VS Code 設定を使います。workflow-register などから action provider を呼ぶ場合は、option として `textEncoding` を渡せます。

```json
{
  "reviewInputPath": "review-input.yaml",
  "reviewPackagePath": ".bob-review/review-package",
  "textEncoding": "cp932"
}
```

## 注意点

- 生成される `review-package`、`bob-input.md`、triage ファイルは UTF-8 で保存します。
- `auto` は UTF-8 と Shift-JIS 系の両方を完全判定するものではありません。文字化けが残る場合は明示指定してください。
- Git / Bazaar の差分出力がリポジトリ内の複数文字コードを1つの stdout に混在させる場合、1回の decode 設定で全行を完全復元できないことがあります。その場合は対象変更を分割するか、リポジトリ側の出力文字コードを揃えてください。
