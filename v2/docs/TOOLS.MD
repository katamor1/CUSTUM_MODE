対応しました。

**最終コミット**
`fae7cd50e26cb6f38b8b0a81bbed65a77bf5bdba`

主な変更は3つです。

1. **追加ファイルの内容をpacketに入れるように修正**

   * Bazaar diffで `added file` を検出します。
   * 追加ファイルについて `bazaar cat` 相当で対象revisionの内容を取得します。
   * packetに `## Added file contents` セクションとして挿入します。
   * 既定上限は `256KB`、設定 `bobBazaar.maxAddedFileContentBytes` で変更可能です。
   * `0` にすると追加ファイル内容の挿入を無効化します。

2. **GUIのレビューpacket生成にも追加ファイル内容を接続**

   * GUIの「レビューしてBobにADD」でも、追加ファイル内容セクションを生成してからBobへADDします。

3. **Bobに限定検索・Tree-sitter利用を許可**

   * packet本文に「diffだけで不足する場合、targeted text search / Tree-sitter / symbol search / outline / Bazaar file content reads を使ってよい」と明記しました。
   * 対象は、変更ファイル・追加ファイル・diffに出たsymbol・追加された公開定義・checklistに関係する直接参照に限定しています。
   * `.bob` のSkillにも、Tree-sitterやsymbol searchで関数境界、定義位置、参照箇所、呼び出し関係を絞って確認してよい、と入れました。
   * Workflowにも、Bobのread系機能、限定検索、Tree-sitter、symbol search、outlineを使ってよいが、広範囲の無条件読み込みは避ける、という手順を追加しています。

これで、追加ファイルにグローバル変数・構造体・公開関数などがある場合でも、Bob側に最低限の構文解析・限定検索を許可しつつ、コンテキストウィンドウを食いすぎない形になります。

再ビルドしてください。

```powershell
npm run compile
npm run package
code --install-extension .\bob-bazaar-review-0.3.0.vsix --force
```

既存プロジェクトの `.bob` をすでに初期化済みの場合は、テンプレート更新分は自動上書きされません。必要なら `.bob/skills/project-review-checklist/SKILL.md` と `.bob/workflows/bazaar-project-rule-review.md` を今回のテンプレート内容で更新してください。
