実装しました。`bob-code` 本体は変更せず、別VSCode拡張パッケージとして **`bob-bazaar-review`** を追加しています。

**追加場所**
`extensions/bob-bazaar-review/`

**最終コミット**
`73a0e42909b92d90d3ff2991f5e9b5c36932b9b0`

追加した内容は以下です。

| ファイル                  | 内容                                                          |
| --------------------- | ----------------------------------------------------------- |
| `package.json`        | VSCode拡張マニフェスト。`IBM.bob-code` を `extensionDependencies` に指定 |
| `tsconfig.json`       | TypeScriptビルド設定                                             |
| `src/extension.ts`    | VSCodeコマンド実装。MCP登録、revision review、range review             |
| `src/bazaar.ts`       | `bzr` のread-only安全実行ラッパー                                    |
| `src/mcpConfig.ts`    | `.bob/mcp.json` にBazaar MCP serverを登録                       |
| `src/reviewPacket.ts` | Bobへ渡すMarkdownレビュー依頼packet生成                                |
| `src/mcp/server.ts`   | MCP stdio server本体                                          |
| `README.md`           | ビルド・インストール・使い方                                              |

できることは3つです。

```text
Bob Bazaar: Configure Bazaar MCP for Bob
Bob Bazaar: Review Bazaar Revision with Bob
Bob Bazaar: Review Bazaar Revision Range with Bob
```

MCP toolとしては、read-onlyで以下を提供します。

```text
bazaar_root
bazaar_revno
bazaar_log
bazaar_diff_revision
bazaar_diff_range
bazaar_diff_working_tree
bazaar_cat_revision
bazaar_status
```

READMEにも明記しましたが、`commit` / `push` / `pull` / `update` / `revert` / `merge` / `resolve` などの破壊・変更系コマンドは公開していません。

使い方は以下です。

```bash
cd extensions/bob-bazaar-review
npm install
npm run compile
npm run package
```

生成されたVSIXをBob IDE / VSCodeへ入れます。

```bash
code --install-extension bob-bazaar-review-0.1.0.vsix
```

その後、Bazaarワークスペースを開いて、

```text
Bob Bazaar: Configure Bazaar MCP for Bob
```

を実行すると、ワークスペースの `.bob/mcp.json` に `bazaar` MCP server が登録される構成です。READMEにも登録例を入れています。

注意点として、今回はリポジトリへコード追加まで行いましたが、この環境では実際の `npm install && npm run compile` とBob IDE上のMCP接続テストまでは実行していません。次はローカルでコンパイルし、BobのMCP一覧に `bazaar` が出るかを確認する段階です。
