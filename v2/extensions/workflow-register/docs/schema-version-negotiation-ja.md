# Workflow Schema Version Negotiation

## 1. 目的

`WORKFLOW.md` が宣言した schema contract を、別の contract として黙って解釈しないための version routing を定義する。

## 2. 対応表

| `schemaVersion` | Parser | 判定 |
| --- | --- | --- |
| 省略 | legacy | 既存 legacy 規則で解析する。 |
| `legacy` | legacy | 既存 legacy 規則で解析する。 |
| `workflow-register/v1` | v1 | v1 schema と semantic compiler で検証する。 |
| その他の string | なし | unsupported-version error として拒否する。 |
| null / number / boolean / sequence / mapping | なし | non-string error として拒否する。 |

値は完全一致かつ大文字小文字を区別する。明示値を trim、case-fold、legacy downgrade しない。

## 3. 実装境界

`src/core/parser/workflowSchemaVersion.ts` の `resolveWorkflowSchemaVersion(value)` が、既知の二つの route だけを返す。

`parseWorkflowMarkdown()` は YAML front matter を record 化した後、legacy/v1 parser を呼ぶ前に resolver を実行する。resolver error は既存 parser diagnostic wrapperを通り、single compilerから次の全経路へ同じ内容で伝播する。

- direct compile / validation
- current document validation
- workspace validation
- workspace loader
- IBM Bob workflow registration

unsupported document は normalized workflow を持たず、runner、Bob source、workflow registrationを開始しない。

## 4. 診断

Unsupported string:

```text
unsupported schemaVersion "workflow-register/v2"; supported values are 'workflow-register/v1' and 'legacy', or omit the field for legacy workflows.
```

Non-string:

```text
field 'schemaVersion' must be a string when provided; supported values are 'workflow-register/v1' and 'legacy'.
```

string 値の表示には `JSON.stringify()` を使い、改行などの制御文字を1行のescaped diagnosticとして保持する。

## 5. 互換性

- schemaVersionを省略した既存legacy workflowは変更しない。
- explicit `legacy` を受理する。
- v1 parser、v1 schema、definition hash、workflow ID、provider/command ID、runtime contractは変更しない。
- 任意の明示schemaVersionがlegacyとして偶然通っていた挙動は廃止する。これは誤ったcontract downgradeを防ぐ意図的なcorrectness changeである。

## 6. 単体・結合テスト契約

`test/workflowSchemaVersionNegotiation.test.js` は次を検証する。

1. omitted / explicit legacy compatibility。
2. exact v1 routingは既存v1 testsで維持する。
3. future version、case typo、control-character stringの拒否。
4. number、boolean、null、sequence、mappingの拒否。
5. compiler / current document / workspace validation / loader / registrationのdiagnostic parity。
6. unsupported documentでrunner creation、source registration、workflow registrationが0件であること。

GitHub Actionsがrunner step開始前に失敗する場合、そのrunをtest failureまたはPASSへ読み替えない。runner/log blockerとして別に記録し、利用可能な環境でfocused/full suiteを再実行する。
