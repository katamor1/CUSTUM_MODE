# ビルド・リリース手順書

## 1. 文書情報

| 項目 | 内容 |
| --- | --- |
| システム名 | DiffRepo Report Builder |
| 対象バージョン | 0.1.0 |
| 更新日 | 2026-06-19 |
| 対象OS | Windows |

## 2. 前提条件

### 2.1 開発環境

| 項目 | 内容 |
| --- | --- |
| OS | Windows |
| Shell | PowerShell |
| Node.js | npmが利用可能なNode.js |
| リポジトリ | `C:\Users\stell\source\repos\diffRepo` |

### 2.2 実行時外部ツール

| ツール | 必須 | 用途 |
| --- | --- | --- |
| WinMergeU.exe | 必須 | テキストファイル単位のHTML差分生成 |
| `bzr`または`brz` | Bazaar比較時 | リビジョンexport |
| Microsoft Excel | 任意 | 生成された`.xlsx`の閲覧 |
| Microsoft Word | 任意 | 生成された`.docx`の閲覧 |

Excelブック生成はExcelJSで行う。Microsoft Excel、Excel COM、PowerShellは実行時のブック生成依存ではない。

### 2.3 同梱ランタイム資産

次のWASMを配布物へ含める。

- `tree-sitter.wasm`
- `tree-sitter-c.wasm`

`electron.vite.config.ts`がビルド時に`out/main/tree-sitter-assets`へコピーし、`electron-builder`が`out/**/*`として収録する。

## 3. 作業ツリー確認

```powershell
git status --short --untracked-files=all
git branch --show-current
```

意図しない変更を戻さず、対象変更と他作業者の変更を識別する。

## 4. 依存関係

ロックファイルどおりに導入する。

```powershell
npm ci
```

`package-lock.json`を更新する必要がある場合だけ次を使う。

```powershell
npm install
```

主要な実行依存:

| パッケージ | 用途 |
| --- | --- |
| `electron` | Main/Renderer/utility process |
| `exceljs` | ストリーミング`.xlsx`生成 |
| `docx` | Word生成 |
| `cheerio` | 非WinMerge HTMLフォールバック |
| `web-tree-sitter` | WASM版Tree-sitter runtime |
| `@cursorless/tree-sitter-wasms` | Tree-sitter C grammar WASM |

## 5. 自動テスト

```powershell
npm test
```

合格基準:

- 全テストファイルが成功する。
- `Ran 0 tests`等の未検出状態でない。
- タイムアウト、未処理例外がない。
- COM旧経路不在テスト、出力トランザクション、中止、Tree-sitter、C仕様テストが成功する。

## 6. ビルド

```powershell
npm run build
```

このコマンドは次を実行する。

1. `tsc --noEmit`
2. `electron-vite build`
3. Main、Worker、Preload、Rendererの出力
4. Tree-sitter WASM資産のコピー

### 6.1 生成物確認

```powershell
$required = @(
  'out\main\index.js',
  'out\worker\index.js',
  'out\preload\index.mjs',
  'out\renderer\index.html',
  'out\main\tree-sitter-assets\tree-sitter.wasm',
  'out\main\tree-sitter-assets\tree-sitter-c.wasm'
)
$required | ForEach-Object {
  [pscustomobject]@{ Path = $_; Exists = Test-Path $_ }
}
```

全行の`Exists`が`True`であること。

WorkerはMainから`path.join(__dirname, "../worker/index.js")`で起動されるため、`out/worker/index.js`が必須である。

## 7. 配布パッケージ

### 7.1 展開ディレクトリ

```powershell
npm run dist:dir
```

既定生成先:

```text
dist/win-unpacked/DiffRepo Report Builder.exe
```

出力先がロックされている場合:

```powershell
.\node_modules\.bin\electron-builder.cmd --win --dir --publish never --config.directories.output=dist\release-check
```

### 7.2 Portable

```powershell
npm run dist
```

生成物:

```text
DiffRepo Report Builder-0.1.0-x64.exe
```

### 7.3 パッケージ内容確認

`win-unpacked`内でWASMとWorkerが存在することを確認する。

```powershell
$packageRoot = Resolve-Path 'dist\win-unpacked'
Get-ChildItem $packageRoot -Recurse -File |
  Where-Object {
    $_.Name -in @('tree-sitter.wasm', 'tree-sitter-c.wasm') -or
    $_.FullName -match '[\\/]worker[\\/]index\.js$'
  } |
  Select-Object FullName, Length
```

ASARへ格納される構成ではファイルが直接列挙できない場合があるため、その場合は次節の実動作で確認する。

## 8. 起動確認

```powershell
$exe = Resolve-Path 'dist\win-unpacked\DiffRepo Report Builder.exe'
$p = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 8
$stillRunning = -not $p.HasExited
if ($stillRunning) {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
$stillRunning
```

合格基準:

- プロセスが起動する。
- 8秒程度でクラッシュしない。
- 確認後にアプリとWorkerの残プロセスがない。

## 9. 設定確認

1. 設定ダイアログを開く。
2. C系とその他の表示・保持行数が既定で`100`であることを確認する。
3. 両方の「手動修正用の保持行を非表示にする」が有効であることを確認する。
4. WinMerge既知パスが存在する環境では自動設定されることを確認する。
5. Bazaar/Breezyが既定で`brz`であることを確認する。
6. 値を保存してアプリを再起動し、設定が保持されることを確認する。
7. 負数、小数、空文字が保存できないことを確認する。

設定ファイルはElectronの`userData`配下の`settings.json`である。

## 10. 手動受入

### 10.1 フォルダ比較

1. 変更前/変更後フォルダを指定する。
2. ExcelとWordの保存先を指定する。
3. 実行する。
4. 進捗が`scanning`、`reporting`、`workbook`、`analyzing-c`、`resolving-types`、`writing-document`、`done`相当で更新されることを確認する。
5. ExcelとWordが両方生成されることを確認する。
6. Excel/PowerShellが自動起動しないことを確認する。

### 10.2 Excel

1. `.c`、`.h`、その他テキスト、追加、削除を含む比較を実行する。
2. 差分を含む`.c`関数全体が存在することを確認する。
3. 選別範囲外行がExcelに書き込まれていないことを確認する。
4. 保持行の非表示設定を切り替え、保持行だけが表示/非表示になることを確認する。
5. パス置換、空側ラベル、E1、色、rich textを確認する。

### 10.3 Word

1. 文書に次の3章があることを確認する。
   - 変更ファイル一覧
   - 新規関数仕様書
   - 新規変数仕様書
2. 未変更のafter側`.c`から新規関数への直接識別子呼び出し元が出力されることを確認する。
3. 新規関数を関数内`static const`関数ポインタテーブルへ追加したサンプルで、テーブルを持つ関数が新規関数仕様書の呼び出し元に表示されることを確認する。
4. 新規struct/unionでは全メンバーが出力されることを確認する。
5. 既存struct/unionでは新規メンバーだけが出力されることを確認する。
6. MSVC 32bitの配列/struct/union/packサイズと、解決不能項目の`算出不可`を確認する。

### 10.4 Bazaar比較

1. 入力モードをBazaarへ切り替える。
2. リポジトリ、変更前/変更後リビジョンを指定する。
3. `bzr`または`brz`を指定する。
4. 実行し、2回のexport後にフォルダ比較と同じExcel/Wordが生成されることを確認する。

## 11. 中止・終了確認

### 11.1 画面から中止

1. 十分な処理時間がある比較を開始する。
2. WinMerge実行中またはExcel/C解析中に中止する。
3. 状態が「中止中」から「中止しました」へ遷移することを確認する。
4. WinMerge/Bazaarの子プロセスとWorkerが残らないことを確認する。
5. `.tmp`/`.bak`と作業ディレクトリが残らないことを確認する。

### 11.2 終了時中止

1. ジョブ実行中にウィンドウを閉じる。
2. 即時破棄されず、中止後に閉じることを確認する。
3. アプリ終了操作でも同じことを確認する。

### 11.3 出力保護

1. 既存のExcelとWordを用意する。
2. ジョブ実行中に中止または意図的なエラーを発生させる。
3. 既存2ファイルが元の内容で残ることを確認する。
4. 新規出力先の場合は片方だけのfinalが残らないことを確認する。

## 12. リリース成果物

| 成果物 | 内容 |
| --- | --- |
| `DiffRepo Report Builder-0.1.0-x64.exe` | Portable配布ファイル |
| または`win-unpacked/` | 展開済み検証用 |
| `docs/` | 基本設計、詳細設計、テスト設計、ビルド手順 |

配布物にはMain、Worker、Preload、Renderer、Tree-sitter runtime WASM、Tree-sitter C grammar WASMが含まれること。

## 13. リリース前チェックリスト

- [ ] 対象ブランチと作業ツリーを確認した。
- [ ] `npm ci`が成功した。
- [ ] `npm test`が全件成功した。
- [ ] `npm run build`が成功した。
- [ ] Main/Worker/Preload/Renderer生成物が存在する。
- [ ] Tree-sitterの2つのWASMが存在する。
- [ ] `npm run dist`または`npm run dist:dir`が成功した。
- [ ] パッケージ後exeが起動する。
- [ ] 設定の既定値、保存、入力検証を確認した。
- [ ] フォルダ比較でExcel/Wordが生成される。
- [ ] Excelはファイル単位処理で、選別外行を書き込まない。
- [ ] Wordは3章とC仕様表を出力する。
- [ ] 全after側C系ファイルからの直接識別子呼び出しと関数内`static`/`const`関数ポインタテーブル登録による呼び出し元を確認した。
- [ ] 新規型全メンバー/既存型新規メンバーだけを確認した。
- [ ] MSVC 32bit、`#pragma pack`、`算出不可`を確認した。
- [ ] 中止と終了時中止で既存出力を保護できる。
- [ ] Excel COM、Excel、PowerShellを生成経路として使用していない。

## 14. トラブルシュート

### 14.1 Tree-sitter WASMが見つからない

症状:

```text
Tree-sitter runtime WASM asset was not found
Tree-sitter C grammar WASM asset was not found
```

確認:

```powershell
Get-ChildItem 'out\main\tree-sitter-assets' -File
```

`npm run build`を再実行し、依存パッケージと`electron.vite.config.ts`のコピー処理を確認する。

### 14.2 Workerが起動しない

確認:

- `out/worker/index.js`が存在する。
- パッケージへ`out/**/*`が含まれる。
- Mainのログにutility process終了コードまたはfatal errorがないか確認する。

### 14.3 中止後も外部プロセスが残る

確認:

```powershell
Get-Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ProcessName -match 'WinMerge|brz|bzr|DiffRepo'
  } |
  Select-Object Id, ProcessName, Path
```

ジョブ所有外のプロセスを一括終了しない。対象PIDを確認して対処する。

### 14.4 `.tmp`または`.bak`が残る

原因候補:

- 強制終了中に復旧処理も中断された。
- 出力ファイルが他アプリにロックされている。
- backup復元自体が失敗した。

対象ファイル名の`diffrepo-<jobId>`を確認し、final、stage、backupの内容を比較してから復旧する。backupを機械的に削除しない。

### 14.5 WinMerge実行エラー

確認:

- 設定ダイアログのWinMergeU.exeパス
- 対象ファイルの読取権限
- HTML出力先の書込権限
- stderrに含まれる終了理由

### 14.6 Bazaar exportエラー

確認:

- `bzr`/`brz`実行ファイルまたはコマンド名
- リポジトリパスとリビジョン
- 一時フォルダの権限
- stderrに含まれる終了理由

### 14.7 Excel/Word確定エラー

確認:

- finalファイルがExcel/Word等で開かれていない。
- finalと同じディレクトリへstage/backupを作成できる。
- ディスク空き容量がある。
- ExcelとWordのstageが両方生成されている。

## 15. バージョン更新

`package.json`の`version`を更新する。

```json
{
  "version": "0.1.0"
}
```

ロックファイルを同期する。

```powershell
npm install --package-lock-only
```

更新後にテスト、ビルド、Portable名を再確認する。

## 16. ロールバック

問題が見つかった場合は直前のPortableまたは`win-unpacked`一式へ戻す。

確認事項:

- `settings.json`の`rowOutput`互換性
- WorkerとMainのメッセージ型互換性
- Excel/Word出力形式
- Tree-sitter WASM同梱
- WinMerge/Bazaar/Breezyパス
