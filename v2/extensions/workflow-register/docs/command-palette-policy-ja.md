# Command Palette 表示名ポリシー

workflow-register の Command Palette 表示名は、VS Code が `category` と `title` を組み合わせて表示する前提で管理します。

- 表示形式は `Bob <English area>: <日本語の操作名>` とする。
- `category` はコロンの手前に出るため、英語の `Bob Workflow` を使う。
- `title` にはコロンを含めず、日本語の操作名だけを書く。
- コロンの手前は ASCII の英数字、空白、`&`、`/`、`-` だけで構成する。
