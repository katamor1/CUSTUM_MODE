# テスト設計書

## 1. 文書情報

| 項目 | 内容 |
| --- | --- |
| システム名 | DiffRepo Report Builder |
| 対象バージョン | 0.1.0 |
| 更新日 | 2026-06-19 |
| テスト種別 | Vitest自動テスト、ビルド検証、手動受入 |

## 2. テスト方針

- Core、Main、Worker、Shared、Renderer補助ロジックをVitestで検証する。
- Excel/Wordは生成ファイルを読み戻し、値、構造、スタイル、行状態、文書XMLを検証する。
- 重処理分離はutility processそのものを単体起動せず、`JobManager`とWorkerプロトコルの境界をモックして検証する。
- 中止はAbortSignal伝播、所有プロセスツリー停止、5秒後のWorker強制停止、終了時中止を分けて検証する。
- ExcelとWordはstageへ生成され、両方成功時だけfinalへ確定されることを検証する。
- ExcelはHTMLファイルパス受け渡し、ファイル単位処理、選別外行の未書き込み、保持行の表示/非表示を検証する。
- C仕様はTree-sitter C WASM、変更前後プロジェクト差分、全after側C系ファイルからの直接識別子呼び出しと関数内`static`/`const`関数ポインタテーブル登録による呼び出し元、通常ポインタ/マクロ/関数外の除外、MSVC 32bitサイズを検証する。
- Microsoft Excel、Excel COM、PowerShellをブック生成テストの前提にしない。

## 3. テスト環境

| 項目 | 内容 |
| --- | --- |
| OS | Windows |
| ランタイム | Node.js / npm |
| フレームワーク | Vitest |
| Excel検証 | ExcelJS |
| Word検証 | JSZipで`.docx`内部XMLを確認 |
| C解析 | `web-tree-sitter`、同梱Tree-sitter C WASM |
| 外部ツール | WinMerge、Bazaar/Breezyは結合/手動試験で使用 |

## 4. 自動テスト構成

### 4.1 ジョブ・中止・出力

| テストファイル | 主な検証 |
| --- | --- |
| `tests/main/jobManager.test.ts` | 単一ジョブ、ready後開始、所有者中止、5秒強制停止、Worker異常終了復旧 |
| `tests/main/windowClose.test.ts` | 実行中closeの保留、中止待ち、ジョブなし即時終了 |
| `tests/worker/workerProtocol.test.ts` | ready、進捗、完了、中止、失敗phaseの直列化 |
| `tests/core/processRunner.test.ts` | AbortError、所有プロセスツリー停止、終了時間上限、stderr/Shift_JIS |
| `tests/core/outputTransaction.test.ts` | stage/backup名、一括昇格、2件目失敗ロールバック、中断復旧 |
| `tests/core/reportJob.test.ts` | reporting/workbook中止、部分出力非公開、WinMerge/Bazaar、C仕様統合 |

### 4.2 設定・UI補助

| テストファイル | 主な検証 |
| --- | --- |
| `tests/shared/settings.test.ts` | ネスト既定値、0以上の安全な整数 |
| `tests/main/settings.test.ts` | 旧設定の補完、不正設定の保存拒否 |
| `tests/renderer/settingsValidation.test.ts` | 0/整数の受理、空/負数/小数/unsafe/非数値の拒否 |
| `tests/renderer/runState.test.ts` | 設定読込前、実行中、中止中の編集ロック |
| `tests/renderer/modalFocus.test.ts` | 設定ダイアログ初期フォーカスとTab循環 |
| `tests/renderer/uiText.test.ts` | 設定、中止、状態の日本語文言 |

### 4.3 HTML・Excel

| テストファイル | 主な検証 |
| --- | --- |
| `tests/core/htmlReport.test.ts` | WinMerge高速解析、fallback、CSS、colspan、rich text、大規模HTML |
| `tests/core/reportRowSelection.test.ts` | 表示/保持/除外、空行コンテキスト、C関数、N=0、範囲統合、性能 |
| `tests/core/excelExporter.test.ts` | HTMLファイル単位処理、選別外行未書込、シート、色、パス、rich text、保持行非表示 |
| `tests/core/cPathAnalysis.pathMarkers.test.ts` | パステスト確認欄の根拠となるC line facts、新規関数marker reason |
| `tests/core/reportPipelineTiming.test.ts` | `DIFFREPO_MEASURE_REPORT=1`時だけ実行するローカル計測、phase別処理時間 |
| `tests/core/obsoleteWorkbookPaths.test.ts` | COM、非ストリーミング、出力後行制御の旧経路がソースにないこと |
| `tests/core/sheetNames.test.ts` | シート名一意化、禁止文字、31文字制限 |

### 4.4 C解析・Word

| テストファイル | 主な検証 |
| --- | --- |
| `tests/core/treeSitterRuntime.test.ts` | runtime WASMとC grammar WASMの読み込み |
| `tests/core/cProjectSources.test.ts` | 全`.c`/`.h`収集、正規化、AbortSignal |
| `tests/core/cProjectParser.test.ts` | 関数/変数/型/呼び出し/マクロ/pack/診断 |
| `tests/core/cProjectIndex.test.ts` | 直接識別子呼び出し/関数内`static`/`const`関数ポインタテーブル登録の呼び出し元、通常ポインタ/マクロ/関数外除外、shadow除外、static解決、曖昧呼び出し |
| `tests/core/cSpecificationDiff.test.ts` | 新規関数/変数、新規型全メンバー、既存型追加メンバー |
| `tests/core/cSpecificationBuilder.test.ts` | Doxygen、呼び出し元、変数/型/メンバー仕様 |
| `tests/core/cSpecificationProject.test.ts` | 全after側C系ファイルによる呼び出し元/型解決 |
| `tests/core/cTypeLayout.test.ts` | MSVC 32bit、配列、struct/union、pack、算出不可 |
| `tests/core/cFunctionChanges.test.ts` | Tree-sitterによる変更/新規/削除関数 |
| `tests/core/changeListDocument.test.ts` | 変更一覧と3章の仕様表 |

## 5. 機能別テスト

### 5.1 設定ダイアログ

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| SET-01 | 初回起動 | C系/その他とも保持行数100、非表示有効 |
| SET-02 | WinMerge既定 | 64bit、32bit既知パスの順に検出し、未検出時は空 |
| SET-03 | Bazaar既定 | `brz` |
| SET-04 | 保持行数0 | 保存できる |
| SET-05 | 負数/小数/空/unsafe | エラー表示し保存しない |
| SET-06 | 保存後再起動 | `settings.json`から同じ値を復元 |
| SET-07 | 旧設定 | 欠けた`rowOutput`項目を既定値で補完 |
| SET-08 | 実行中/中止中 | 設定と入力を変更できない |
| SET-09 | モーダル操作 | 初期フォーカス、Tab循環、Escape/閉じるが機能 |

### 5.2 utility processと進捗

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| JOB-01 | Worker起動 | `ready`後にだけ`start`を送る |
| JOB-02 | 同時実行 | 2件目を拒否 |
| JOB-03 | 進捗 | 対象ジョブのphase/messageだけをRendererへ転送 |
| JOB-04 | staleメッセージ | 終了済み/別ジョブのメッセージを無視 |
| JOB-05 | Worker失敗 | phase付きエラーを返し、出力を復旧 |
| JOB-06 | Worker異常終了 | 終了コードを含む失敗とし、出力/作業領域を復旧 |

### 5.3 中止と終了

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| CAN-01 | 実行画面で中止 | 状態が中止中となり、Workerへcancel |
| CAN-02 | WinMerge実行中 | 当該プロセスツリーを停止し、AbortError |
| CAN-03 | Bazaar実行中 | 当該プロセスツリーを停止 |
| CAN-04 | Excel書込中 | signal検出後にstageを削除しfinalを公開しない |
| CAN-05 | C解析/Word中 | 中止し、stage/作業領域を削除 |
| CAN-06 | Worker無応答 | 5秒後にutility processを強制停止 |
| CAN-07 | 別Renderer中止 | 所有ジョブを中止しない |
| CAN-08 | 実行中ウィンドウ終了 | closeを保留し、中止完了後にdestroy |
| CAN-09 | 実行中アプリ終了 | before-quitを保留し、中止完了後にquit |

### 5.4 出力トランザクション

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| TX-01 | stage名 | finalと同じディレクトリのジョブ固有`.tmp` |
| TX-02 | backup名 | finalと同じディレクトリのジョブ固有`.bak` |
| TX-03 | 正常完了 | Excel/Word両方をfinalへ昇格しbackupを削除 |
| TX-04 | stage片方欠落 | finalを変更しない |
| TX-05 | 2件目昇格失敗 | 1件目も戻し、既存2出力を復元 |
| TX-06 | 新規出力の中断 | 中途半端なfinal/stageを除去 |
| TX-07 | 既存出力の中断 | backupから既存出力を復元 |
| TX-08 | cleanup再実行 | finalを消さず冪等に完了 |

### 5.5 Excelファイル単位処理

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| XL-01 | 入力形式 | `HtmlReportFile`はHTML本文でなく`htmlPath`を持つ |
| XL-02 | 複数HTML | 1件ずつread/parse/write/worksheet commit |
| XL-03 | ブックWriter | ExcelJSストリーミングWriterを使用 |
| XL-04 | COM旧経路 | ソースにExcel COM/非ストリーミング専用経路がない |
| XL-05 | シート | 変更テキストファイルごとに1件 |
| XL-06 | パス | `【変更前】$/...`、`【変更後】$/...` |
| XL-07 | 空側 | 追加/削除に応じ「ファイルなし」 |
| XL-08 | レビュー欄 | E1が`■OK □NG` |
| XL-09 | HTML装飾 | 色、太字、斜体、下線、rich textを保持 |
| XL-10 | 選別外行 | Excelへ書き込まれない |
| XL-11 | 保持行非表示有効 | `retained`だけ`hidden=true` |
| XL-12 | 保持行非表示無効 | `retained`を表示 |
| XL-13 | 表示対象 | `visible`は設定にかかわらず表示 |

### 5.6 行選別

保持行数を`N`とする。

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| ROW-01 | その他テキスト | 差分から前後空行と空行外側N行を表示 |
| ROW-02 | `.h` | C系ポリシーでROW-01と同じ選別 |
| ROW-03 | `.c`差分関数 | 関数全体を表示 |
| ROW-04 | `.c`非差分関数 | 通常表示対象から除外 |
| ROW-05 | `.c`関数外差分 | 関数範囲を越えず空行コンテキストを表示 |
| ROW-06 | 保持範囲 | 表示対象の前後N行を保持行にする |
| ROW-07 | 関数境界 | 保持範囲の拡張は関数境界を越えられる |
| ROW-08 | `N=0` | 空行外側/保持の追加行なし |
| ROW-09 | 追加/削除行 | WinMerge背景色を差分として扱う |
| ROW-10 | 重複範囲 | 統合し、元の順序を維持 |
| ROW-11 | 大規模全差分 | 5000行を規定時間内に分類 |

### 5.7 Word 3章

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| WD-01 | 章構成 | 変更ファイル一覧/新規関数仕様書/新規変数仕様書 |
| WD-02 | 全変更ファイル | バイナリも変更ファイル一覧へ出力 |
| WD-03 | 変更`.c` | 変更/新規/削除関数を字下げ |
| WD-04 | 新規関数なし | 「該当なし」 |
| WD-05 | 新規変数なし | 「該当なし」 |
| WD-06 | Doxygen不足 | 対象項目を「記載なし」 |
| WD-07 | サイズ数値 | `<n> bytes` |
| WD-08 | サイズ不確定 | `算出不可` |

### 5.8 全after側呼び出し元

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| CALL-01 | 未変更after側ファイルの直接呼び出し | 新規関数の呼び出し元に含む |
| CALL-02 | 複数回呼び出し | 呼び出し元関数を1件だけ出力 |
| CALL-03 | 同一ファイルstatic | 同一ファイルのstatic定義へ解決 |
| CALL-04 | 一意なglobal | 対象global関数へ解決 |
| CALL-05 | 同名global複数 | 割り当てず「呼び出し先特定不可」 |
| CALL-06 | ローカル/引数shadow | 呼び出し元にしない |
| CALL-07 | 通常の関数ポインタ変数/マクロ/関数外 | 呼び出し元にしない |
| CALL-08 | 表示順 | パス、関数名、ID順 |
| CALL-09 | 関数内`static`/`const`関数ポインタテーブル登録 | テーブルを持つ関数を呼び出し元にする |

### 5.9 struct/union差分

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| REC-01 | 新規struct | 全メンバーを出力 |
| REC-02 | 新規union | 全メンバーを出力 |
| REC-03 | 既存型へ新規メンバー | 新規メンバーだけ出力 |
| REC-04 | 既存メンバー型変更 | 新規メンバー扱いにしない |
| REC-05 | 匿名型 | 相対パス、親宣言、位置で識別 |
| REC-06 | 新規ファイル | 対象シンボルをすべて新規扱い |

### 5.10 MSVC 32bitレイアウト

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| LAY-01 | builtin/pointer/enum | 実装済みMSVC 32bitサイズ |
| LAY-02 | typedef/固定幅型 | 参照先型と標準固定幅・ポインタ幅型を解決 |
| LAY-03 | マクロ配列 | 次元、要素数、総サイズを算出 |
| LAY-04 | struct | alignmentと末尾paddingを反映 |
| LAY-05 | union | 最大メンバーとalignmentを反映 |
| LAY-06 | pack push/pop | スタックをファイル順に反映 |
| LAY-07 | pack set/reset | 指定値と既定8へ切替 |
| LAY-08 | 自己参照ポインタ | 4byteポインタとして解決 |
| LAY-09 | 外部型/値再帰/VLA/flexible/bitfield | `算出不可` |
| LAY-10 | ヘッダガード | 分岐内のglobal/typedef/recordを取得し、関数ローカルrecordを除外 |
| LAY-11 | 解析中止 | 呼び出し元・仕様モデル構築中も`AbortSignal`で停止 |

### 5.11 パステスト精度とHTML生成速度

| No. | 観点 | 期待結果 |
| --- | --- | --- |
| PT-01 | 変更済み関数の確認欄根拠 | WinMergeの行対応とC解析のline factsを組み合わせ、コメント、波括弧、宣言行だけではE列確認欄を付けない |
| PT-02 | marker reason | 変更実行行、変更分岐、追加関数入口、追加分岐、削除コードfallbackを区別できる |
| PT-03 | raw diff色だけの誤検知防止 | WinMergeが差分色を付けた行でも、C line factが未変更または非reviewableならE列は空欄 |
| PT-04 | WinMerge HTML生成並列化 | ファイル単位の独立したHTML生成をbounded concurrencyで実行し、Excel出力へ渡す`reports`順は従来通り相対パス順を保つ |
| PT-05 | 計測 | `npm run measure:report`で`local-samples/path-test-accuracy-speed/output/timings.json`を作成し、baseline/afterの`reporting`と`workbook` phaseを比較できる |

## 6. 手動受入

### 6.1 設定と通常実行

1. アプリを起動し、設定ダイアログを開く。
2. C系/その他の保持行数と非表示を変更して保存する。
3. WinMergeとBazaar/Breezyの既定値/参照選択を確認する。
4. フォルダ比較を実行し、進捗phaseが更新されることを確認する。
5. ExcelとWordが両方生成されることを確認する。
6. 再起動後も設定が保持されることを確認する。

### 6.2 Excel

1. C系とその他テキストを含むサンプルを実行する。
2. 選別範囲外行がシートに存在しないことを確認する。
3. 保持行の非表示設定を切り替え、行の表示状態だけが変わることを確認する。
4. 差分関数全体、関数外差分、追加/削除行、パス、色、rich textを確認する。
5. 実行中にMicrosoft ExcelやPowerShellプロセスが起動しないことを確認する。

### 6.3 Word

1. 新規関数、新規グローバル変数、新規struct/union、既存型の新規メンバーを含むサンプルを実行する。
2. 3章が順番どおり存在することを確認する。
3. 新規struct/unionは全メンバー、既存型は追加メンバーだけであることを確認する。
4. 未変更のafter側`.c`からの直接識別子呼び出しと関数内`static`/`const`関数ポインタテーブル登録による呼び出し元が出て、通常ポインタ/マクロ/関数外は除外されることを確認する。
5. pack適用サイズと`算出不可`表示を確認する。

### 6.4 中止・終了

1. WinMerge処理中に中止し、外部プロセスとWorkerが終了することを確認する。
2. Excel処理中に中止し、既存出力が保護されることを確認する。
3. 実行中にウィンドウを閉じ、中止後に画面が閉じることを確認する。
4. `.tmp`/`.bak`/作業ディレクトリが残らないことを確認する。

## 7. 回帰コマンド

```powershell
npm test
npm run build
```

パッケージ確認:

```powershell
npm run dist:dir
```

## 8. 合格基準

- `npm test`が全件成功する。
- `npm run build`が成功する。
- `out/main/tree-sitter-assets`へ2つのWASMが生成される。
- ExcelとWordが両方完成した場合だけ最終出力が更新される。
- 中止/終了時に既存出力を破壊せず、所有プロセスと一時物を後処理する。
- Excelはファイル単位のExcelJS経路で生成され、選別外行を書き込まない。
- Wordは3章を持ち、全after側C系ファイルを使った仕様情報を出力する。

## 9. 手動依存

| 項目 | 理由 |
| --- | --- |
| 実WinMerge HTMLの見た目 | WinMerge版とExcel表示環境に依存 |
| 実Bazaar/Breezy export | ローカルコマンドとリポジトリに依存 |
| 実Wordレイアウト | Wordレンダリングに依存 |
| Electron終了操作 | 実ウィンドウイベントの確認が必要 |
| OSプロセス表示 | 実Windows上での非表示/終了確認が必要 |
