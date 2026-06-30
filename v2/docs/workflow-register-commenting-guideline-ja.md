# workflow-register コメント方針

## 目的

`workflow-register` は workflow の定義、GUI 編集、Markdown/YAML 変換、VS Code Webview をまたぐ実装になっている。

今後の保守では、単にコメント量を増やすのではなく、変更時に壊しやすい境界や、コードだけでは意図が伝わりにくい判断を明示する。

## コメントを書くべき場所

- exported type / function / class の責務。
- YAML front matter と Markdown body の変換境界。
- parser / validator / loader / serializer の責務分担。
- VS Code extension host と Webview client script の message 境界。
- 既存 workflow との互換性維持のための制約。
- 表記安定化など、動作ではなく差分品質を守る処理。
- step / resultKey / includeState / artifacts.producedBy のような参照関係。
- backup / overwrite / diff preview のようにファイルへ副作用がある処理。

## コメントを書かない場所

- コードを読めば分かる代入や分岐。
- 実装と同期しづらい長すぎる手順説明。
- 実装予定だけを書いた曖昧な TODO。
- 関数名や型名をそのまま日本語にしただけのコメント。

## 推奨する粒度

よい例:

```ts
/**
 * Converts the GUI authoring model into a complete WORKFLOW.md file.
 *
 * The serializer owns both YAML front matter generation and Markdown body
 * preservation so the Builder can edit structured fields without discarding
 * hand-written workflow documentation.
 */
```

避ける例:

```ts
// name を正規化する
const name = normalizeWorkflowName(model.metadata.name)
```

## コメント更新ルール

- 挙動を変える PR では、該当する責務コメントと README も更新する。
- コメントが実装と矛盾した場合、コメントを削るか修正する。
- 迷った場合は「何をしているか」より「なぜそうしているか」を書く。
