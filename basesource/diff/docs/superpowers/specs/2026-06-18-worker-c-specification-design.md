# 負荷処理分離・C新規仕様書生成設計

## 1. 目的

次の2点を同時に実現する。

1. HTML解析、Excel生成、Cソース解析、Word生成などの負荷処理をElectronのUI・メインプロセスから分離し、処理中も画面操作と進捗表示を継続できるようにする。
2. 既存のWord変更一覧へ、新規関数仕様書と新規変数仕様書を追加する。

本設計は、次の設計書を前提とする。

- `docs/superpowers/specs/2026-06-18-report-parameter-settings-design.md`

## 2. 対象範囲

### 2.1 対象

- Electron `utilityProcess`によるレポートジョブの別プロセス化
- 単一ジョブ管理、進捗通知、中止、ウィンドウ終了時の停止
- 実行中のWinMerge、Bazaar/Breezyプロセスの停止
- 中止・失敗時の一時ファイルと途中成果物の削除
- Tree-sitter CのWASM版を使った変更後Cソースツリー解析
- Doxygenコメント解析
- 新規関数と直接呼び出し元の抽出
- 新規グローバル変数、構造体、共用体、メンバーの抽出
- MSVC 32bit基準の型・配列・構造体・共用体サイズ計算
- Word文書の3章構成化

### 2.2 対象外

- マクロ展開後の関数呼び出し解析
- 関数ポインタ経由、コールバック登録経由の呼び出し解析
- Cプリプロセッサの完全実装
- MSVCコンパイラと同一の完全なABI・レイアウト再現
- C++ソースの仕様書生成
- 既存関数・既存変数の説明や型の変更仕様書
- 既存構造体・共用体メンバーの型、配列数、コメントだけの変更

## 3. 全体構成

```text
Renderer
  ├─ 入力・設定
  ├─ 実行 / 中止
  └─ 進捗・ログ・結果表示
          │ IPC
          ▼
Electron Main
  ├─ JobManager
  ├─ ダイアログ・設定保存
  └─ ウィンドウライフサイクル
          │ utilityProcessメッセージ
          ▼
Report Worker
  ├─ Bazaar/Breezy export
  ├─ 差分ファイル収集
  ├─ WinMerge HTML生成
  ├─ HTML解析・行分類・ExcelJS出力
  ├─ Tree-sitter C WASM解析
  ├─ Doxygen解析
  ├─ 型サイズ計算
  └─ Word 3章出力
```

RendererとMainは、HTML本文、構文木、Excel行、Word表データを保持しない。ジョブ要求、進捗、結果、中止要求だけをプロセス間で送受信する。

## 4. Utility Process設計

### 4.1 採用理由

Electronの`utilityProcess.fork()`でNode.js実行環境を持つ専用プロセスを起動する。

- CPU負荷とヒープをMainから分離できる。
- ワーカー障害がウィンドウ制御へ直接波及しにくい。
- Electronのメッセージチャネルを使用できる。
- ネイティブNodeアドオンを使わず、Tree-sitterはWASM版を採用するためElectron ABIへの依存を避けられる。

### 4.2 ビルド

`src/worker/index.ts`を独立エントリとしてビルドし、パッケージ後もMainから絶対パスで起動できる位置へ出力する。

Tree-sitter本体WASMとC文法WASMは、開発時と配布後の両方でワーカーが読めるアプリ資産として同梱する。WASMの実体パスをRendererから受け取らず、ワーカーがアプリ資産ルートから解決する。

実装には`web-tree-sitter`を使用し、Tree-sitter C文法から生成されたWASMを固定した依存バージョンの資産として同梱する。起動時にWASMの存在と読込みを検証し、欠落時はジョブ開始前に診断可能なエラーを返す。

### 4.3 JobManager

Mainに`JobManager`を置く。

| 責務 | 内容 |
| --- | --- |
| 同時実行制御 | 実行中ジョブは最大1件 |
| 起動 | utility processを生成し、ジョブ要求を送る |
| 中継 | ワーカー進捗を該当Rendererへ送る |
| 結果 | 完了、中止、失敗をRendererへ返す |
| 中止 | ワーカーへ中止要求を送る |
| 強制停止 | 猶予内に終了しないワーカーを終了する |
| 終了処理 | ウィンドウ終了・アプリ終了時にジョブを停止する |

ジョブには一意な`jobId`を付与し、古いワーカーや別Rendererからのメッセージを混同しない。

### 4.4 メッセージ

Mainからワーカー:

```ts
type MainToWorkerMessage =
  | { type: "start"; jobId: string; request: WorkerJobRequest }
  | { type: "cancel"; jobId: string };
```

ワーカーからMain:

```ts
type WorkerToMainMessage =
  | { type: "ready" }
  | { type: "progress"; jobId: string; progress: ReportProgress }
  | { type: "completed"; jobId: string; summary: GenerateDiffWorkbookSummary }
  | { type: "cancelled"; jobId: string }
  | { type: "failed"; jobId: string; error: SerializedError };
```

エラーは`name`、`message`、`stack`、処理フェーズを文字列へ変換して送る。秘密情報やファイル本文は送らない。

## 5. UI状態とIPC

### 5.1 UI状態

```ts
type RunState =
  | "idle"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";
```

| 状態 | 実行ボタン | 中止ボタン | 設定・入力 |
| --- | --- | --- | --- |
| idle | 有効条件を満たす場合に有効 | 非表示 | 有効 |
| running | 無効 | 有効 | 無効 |
| cancelling | 無効 | 無効 | 無効 |
| completed | 有効 | 非表示 | 有効 |
| cancelled | 有効 | 非表示 | 有効 |
| failed | 有効 | 非表示 | 有効 |

中止ボタンは停止を表すアイコンと「中止」を表示する。中止要求後は状態欄を「中止中」にし、完了後は「中止しました」とする。

### 5.2 Renderer公開API

```ts
interface DiffRepoApi {
  startJob(request: StartJobRequest): Promise<JobResult>;
  cancelJob(): Promise<void>;
  onProgress(callback: (progress: ReportProgress) => void): () => void;
}

type JobResult =
  | { status: "completed"; summary: GenerateDiffWorkbookSummary }
  | { status: "cancelled" };
```

失敗はIPC例外としてRendererへ通知する。同時実行要求はMainで拒否し、日本語のエラーを返す。

## 6. 中止・終了処理

### 6.1 協調中止

ワーカーはジョブ開始時に`AbortController`を作成し、全段階へ`AbortSignal`を渡す。

- ファイル走査ループ
- Bazaar/Breezy export
- WinMergeレポート生成ループ
- HTML解析・Excelシート生成ループ
- Cファイル解析ループ
- Word仕様書生成

各ループは少なくともファイル単位で中止状態を確認する。大きな単一HTMLの解析では、パーサの主要走査ループでも一定間隔で確認できる構造にする。

### 6.2 外部プロセス

`runProcess`を中止可能にし、起動中の子プロセスを追跡する。

1. 中止時に通常終了を要求する。
2. 短い猶予後も終了しない場合、Windowsのプロセスツリーを終了する。
3. 終了コードではなく中止例外として上位へ返す。

対象はWinMergeとBazaar/Breezyである。別ジョブや利用者が手動起動したプロセスは終了しない。

### 6.3 成果物

最終出力先へ直接書き込まない。ExcelとWordは、各最終出力と同じディレクトリにジョブ固有の一時ファイルとして作成する。

```text
diff-report.diffrepo-<jobId>.tmp.xlsx
diff-change-list.diffrepo-<jobId>.tmp.docx
```

両方の生成が成功し、ストリームが閉じた後に最終名へ反映する。これにより、中止時に既存の完成済み出力を誤って削除しない。

最終反映時は、既存出力がある場合にジョブ固有バックアップ名へ一時退避してから置換する。ExcelとWordの両方を置換できなかった場合は、置換済み成果物を除去し、退避した既存出力を元へ戻す。正常反映後にバックアップを削除する。

中止・失敗時:

- ジョブ固有の一時Excelを削除
- ジョブ固有の一時Wordを削除
- OS一時フォルダ配下の作業ディレクトリを削除
- 既存の最終出力は維持

### 6.4 強制終了

協調中止要求後、5秒以内にワーカーが`cancelled`または終了イベントを返さない場合、Mainがutility processを強制終了する。

Mainも把握しているジョブ固有一時出力を削除する。削除に失敗した場合はログへ残し、次回起動時の古い一時ファイル清掃対象にする。

### 6.5 ウィンドウ終了

実行中にメインウィンドウが閉じられた場合:

1. 初回の`close`を保留する。
2. `JobManager.cancel()`を呼ぶ。
3. 協調中止または強制停止と清掃が完了した後にウィンドウを破棄する。

アプリ全体の終了要求でも同じ経路を使用する。

## 7. C解析基盤

### 7.1 パーサ

WASM版Tree-sitterとTree-sitter C文法を使用する。

- Nodeネイティブアドオンは使用しない。
- 解析単位は変更前・変更後ルート内の`.c`と`.h`。
- 変更判定には変更前と変更後の構文モデルを使用する。
- 呼び出し元と型解決には変更後側の全対象ファイルを使用する。

### 7.2 解析インデックス

変更後側から次のインデックスを構築する。

```ts
interface CProjectIndex {
  functions: FunctionDefinition[];
  directCalls: DirectCall[];
  globalVariables: GlobalVariableDeclaration[];
  recordTypes: RecordTypeDefinition[];
  typedefs: TypedefDefinition[];
  enums: EnumDefinition[];
  integerMacros: IntegerMacroDefinition[];
  packDirectives: PackDirective[];
}
```

ファイルパスは変更後ルートからの`$/...`形式に正規化する。構文ノードそのものはWordモデルへ渡さず、直列化可能な解析モデルへ変換する。

### 7.3 新規判定

| 対象 | 新規ファイル | 既存ファイル |
| --- | --- | --- |
| 関数 | 変更後の全関数定義 | 変更後側だけに存在する関数定義 |
| グローバル変数 | 変更後の全対象宣言 | 変更後側だけに存在する変数名 |
| struct/union | 変更後の全型定義 | 変更後側だけに存在する型 |
| 既存struct/unionのメンバー | 全メンバー | 変更後側だけに存在するメンバー名 |

関数は`.c`の定義を対象とする。関数名変更は旧関数削除と新関数追加として扱う。既存関数の引数、戻り値、説明、本文だけの変更は新規関数仕様書へ出さない。

グローバル変数は`.h`のトップレベル宣言を対象とし、`extern`、`static`、`const`、初期化子付き宣言、1宣言内の複数宣言子を含む。

新規判定に使用する識別子:

| 対象 | 識別子 |
| --- | --- |
| 関数 | 相対パス + 関数名 |
| グローバル変数 | 相対パス + 変数名 |
| 名前付きstruct/union | 種別 + 型名 |
| 匿名struct/union | 相対パス + 親宣言 + 正規化した宣言位置 |
| メンバー | 親型識別子 + メンバー名 |

別ファイルへ移動した関数・変数は、旧位置で削除、新位置で新規として扱う。

次は変数として扱わない。

- 関数引数
- ローカル変数
- struct/unionメンバー
- `#define`
- 関数プロトタイプ
- `typedef`

## 8. Doxygen・コメント解析

### 8.1 関連付け

宣言・定義直前に連続するコメント群を1つのヘッダコメントとして扱う。

- `/** ... */`
- `/*! ... */`
- 連続する通常ブロックコメント
- 連続する行コメント
- コメント間と宣言までの空行
- `/********/`などの仕切りコメント

空行は関連付けを切らない。他のコード、プリプロセッサ命令、宣言が現れた場合は関連付けを切る。仕切りだけのコメントは説明本文から除外する。

変数・メンバーの行末にある次のコメントは、その対象の説明として優先する。

- `///<`
- `//!<`
- `/**<`

### 8.2 関数タグ

| 項目 | 取得元 |
| --- | --- |
| 概要 | `@brief` |
| 詳細説明 | `@details`、タグ外本文 |
| 引数説明 | `@param`、`@param[in]`、`@param[out]`、`@param[in,out]` |
| 戻り値説明 | `@return` |
| 戻り値別説明 | `@retval` |
| 注意事項 | `@note` |
| 警告 | `@warning` |

複数行のタグ本文は次のタグまで連結する。引数名と`@param`名を照合し、該当しないタグも「未対応コメント」として失わず保持する。

コメントまたはタグがない項目は「記載なし」とする。

## 9. 新規関数仕様書

### 9.1 モデル

```ts
interface NewFunctionSpecification {
  name: string;
  relativePath: string;
  declaration: string;
  returnType: string;
  parameters: FunctionParameterSpecification[];
  brief: string;
  details: string;
  returnDescription: string;
  returnValues: DescriptionEntry[];
  notes: string[];
  warnings: string[];
  callers: FunctionCaller[];
}
```

### 9.2 呼び出し元

変更後側の全`.c`を解析し、新規関数名を直接呼び出す`call_expression`を収集する。

- 呼び出し式のcalleeが単純な識別子であるものを対象とする。
- 呼び出しを含む最も内側の関数定義を呼び出し元とする。
- 同じ呼び出し元から複数回呼ばれても1件にまとめる。
- パスと関数名で並べ替える。
- 表示形式は `$/src/module.c : caller_function`。

次は対象外とする。

- 関数ポインタ経由
- マクロ展開で生成される呼び出し
- メンバーアクセスや外部言語連携による間接呼び出し

同名の新規関数が複数ファイルに存在し、静的解析だけで解決できない呼び出しは、候補すべてへ無条件に割り当てず「呼び出し先特定不可」とする。

## 10. 新規変数・型仕様書

### 10.1 グローバル変数

```ts
interface NewGlobalVariableSpecification {
  name: string;
  relativePath: string;
  declaration: string;
  description: string;
  typeName: string;
  arrayDimensions: Array<number | "算出不可">;
  elementCount: number | "算出不可";
  sizeBytes: number | "算出不可";
}
```

変数内容は行末コメントを優先し、なければ直前コメント群から取得する。どちらもない場合は「記載なし」とする。

### 10.2 構造体・共用体

```ts
interface NewRecordSpecification {
  kind: "struct" | "union";
  name: string;
  relativePath: string;
  description: string;
  status: "new-type" | "existing-type-new-members";
  members: RecordMemberSpecification[];
  sizeBytes: number | "算出不可";
  declaredVariables: NewGlobalVariableSpecification[];
}
```

- 新規型は全メンバーを出力する。
- 既存型は変更後側にだけ存在するメンバー名を出力する。
- 既存メンバーの型、配列数、コメントだけの変更は出力しない。
- 型定義と同時に宣言された新規グローバル変数も出力する。
- 匿名型・匿名メンバーは構文位置と宣言文字列で識別し、名称欄を「匿名」とする。
- コメントがない説明は「記載なし」とする。

## 11. MSVC 32bitサイズ計算

### 11.1 基準

- ターゲット: MSVC 32bit
- ポインタ: 4バイト
- 既定の最大アラインメント: 8
- `#pragma pack(push, n)`、`#pragma pack(pop)`、`#pragma pack(n)`、`#pragma pack()`をファイル順に反映
- `enum`: 4バイト
- `long double`: MSVC基準で8バイト

代表的な組込み型:

| 型 | サイズ |
| --- | --- |
| `char`、`signed char`、`unsigned char`、`_Bool` | 1 |
| `short`、`unsigned short`、`wchar_t` | 2 |
| `int`、`unsigned int`、`long`、`unsigned long`、`float` | 4 |
| `long long`、`unsigned long long`、`double`、`long double` | 8 |
| ポインタ | 4 |

### 11.2 型解決

変更後側の全`.h`から次を収集し、循環参照を検出しながら解決する。

- `typedef`
- `struct`
- `union`
- `enum`
- 整数定数のオブジェクト形式`#define`

外部ライブラリやWindows SDKなど、比較対象外で定義される型は「算出不可」とする。

### 11.3 配列数

整数リテラルと、安全な整数定数式だけを評価する。評価器は文字列をJavaScriptとして実行しない。

対応演算子:

```text
+ - * / % << >> & | ^ ~ ( )
```

オブジェクト形式マクロは再帰展開し、循環、関数形式マクロ、未定義識別子、`sizeof`、条件演算子を含む場合は「算出不可」とする。

多次元配列は各次元と総要素数を出力する。

### 11.4 レイアウト

- structは各メンバーを有効アラインメントへ切り上げて配置し、最後に型全体を最大メンバーアラインメントへ切り上げる。
- unionは最大メンバーサイズを型アラインメントへ切り上げる。
- 配列は要素サイズと総要素数の積とする。
- 自己参照ポインタはポインタサイズとして解決する。
- 値としての再帰型、可変長配列、柔軟配列メンバー、解決不能ビットフィールドを含む場合は全体サイズを「算出不可」とする。

## 12. Word文書設計

### 12.1 章構成

1. 変更ファイル一覧
2. 新規関数仕様書
3. 新規変数仕様書

該当対象がない章にも見出しを出し、本文へ「該当なし」と記載する。

### 12.2 第1章

既存仕様を維持する。

- バイナリを含む変更ファイル一覧
- 新規・削除ファイルの接頭辞
- Cソースの変更、新規、削除関数一覧

### 12.3 第2章

新規関数1件ごとに見出しと詳細表を作成する。

基本表:

- 関数名
- 定義ファイル
- 宣言
- 戻り値型
- 概要
- 詳細説明
- 戻り値説明
- 注意事項
- 警告

子表:

- 引数名
- 引数型
- 入出力属性
- 引数説明

別表:

- `@retval`の値と説明
- 呼び出し元一覧

### 12.4 第3章

次の順で出力する。

1. 新規グローバル変数
2. 新規構造体・共用体
3. 既存構造体・共用体の新規メンバー

グローバル変数表:

- 変数名
- 宣言ファイル
- 宣言
- 変数内容
- 型または構造体・共用体名
- 配列数
- 総要素数
- サイズ

構造体・共用体基本表:

- 種別
- 型名
- 宣言ファイル
- 説明
- 全体サイズ
- 同時宣言された新規グローバル変数

メンバー表:

- メンバー名
- 型
- 配列数
- サイズ
- 説明

### 12.5 書式

- Wordの見出しスタイルを使用し、ナビゲーション可能にする。
- 各対象は個別の詳細表とする。
- 表のヘッダ行は塗りつぶしと太字で区別する。
- 長いパス、宣言、説明はセル内折返しを有効にする。
- 数値サイズは`4 bytes`形式、「算出不可」は文字列で出力する。
- パスは`$/...`形式へ統一する。

## 13. 処理フロー

1. 入力解決と変更ファイル収集
2. WinMerge HTML生成
3. Excelブック生成
4. 変更後側の全`.c`・`.h`をTree-sitterで解析
5. 変更前側の変更対象`.c`・`.h`を解析
6. 新規関数・変数・型・メンバー判定
7. Doxygen・コメント関連付け
8. 変更後全`.c`から直接呼び出し元を抽出
9. 変更後全`.h`から型インデックスを構築しサイズ計算
10. Wordの3章を生成
11. Excel・Wordの一時成果物を最終出力へ反映
12. 一時作業フォルダを削除

各段階で進捗フェーズを通知し、中止を確認する。

追加する進捗フェーズ:

- `analyzing-c`
- `resolving-types`
- `writing-document`
- `cancelling`

## 14. モジュール構成

| モジュール | 責務 |
| --- | --- |
| `src/main/jobManager.ts` | utility processの起動、単一ジョブ、中止、強制停止 |
| `src/worker/index.ts` | ワーカーメッセージ受信とジョブ実行 |
| `src/shared/jobMessages.ts` | Mainとワーカー間のメッセージ型 |
| `src/core/processRunner.ts` | AbortSignal対応の外部プロセス実行 |
| `src/core/reportJob.ts` | 中止可能な全体処理の調整 |
| `src/core/cProjectParser.ts` | Tree-sitter初期化、C構文木から解析モデル作成 |
| `src/core/doxygenParser.ts` | コメント群関連付けとDoxygenタグ解析 |
| `src/core/cProjectIndex.ts` | 変更後全体インデックス、呼び出し元検索 |
| `src/core/cSpecificationDiff.ts` | 新規関数、変数、型、メンバー判定 |
| `src/core/cTypeLayout.ts` | MSVC 32bit型サイズ・アラインメント計算 |
| `src/core/changeListDocument.ts` | 3章Word文書生成 |

既存の`cFunctionChanges.ts`は、Tree-sitter解析モデルから変更関数一覧を作る実装へ置換する。軽量な独自C関数パーサは置換完了後に削除する。

## 15. エラー処理

| 状況 | 処理 |
| --- | --- |
| Tree-sitter WASM読込失敗 | ジョブ失敗。資産パスを含む診断をログ出力 |
| 個別Cファイルの構文エラー | 解析可能部分を使用し、対象ファイルと位置を警告へ記録 |
| Doxygen不足 | 項目を「記載なし」として継続 |
| 型解決不能 | サイズを「算出不可」として継続 |
| 呼び出し先曖昧 | 「呼び出し先特定不可」として継続 |
| Word生成失敗 | ジョブ失敗。一時Excel・Wordを削除 |
| 中止 | `cancelled`として終了し、一時成果物を削除 |
| ワーカー異常終了 | Mainが失敗扱いにし、一時成果物を削除 |

構文警告と型解決警告はWordへ注記せず、アプリのログへ件数と対象ファイルを出す。仕様表では該当項目を「算出不可」「記載なし」と明示する。

## 16. テスト設計

### 16.1 JobManager

- 同時に2件開始できない。
- 進捗がRendererへ中継される。
- 正常完了で結果が返る。
- 中止で`cancelled`が返る。
- 応答しないワーカーを5秒後に強制停止する。
- 古い`jobId`のメッセージを無視する。
- ウィンドウ終了時に中止と清掃を完了する。

### 16.2 中止可能処理

- ファイル走査中
- WinMerge実行中
- HTML解析中
- Excel書込み中
- C解析中
- Word書込み中

各段階で、中止後にジョブ固有一時ファイルと作業フォルダが残らず、既存最終出力が維持されることを確認する。

### 16.3 C解析

- 複数行関数宣言、ポインタ引数、配列引数
- 新規ファイルの全関数
- 既存ファイルへ追加された関数
- 既存関数変更の除外
- 直接呼び出し元のパス・関数名・重複排除
- マクロ経由、関数ポインタ経由の除外
- トップレベルの複数変数宣言
- `extern`、`static const`、初期化子
- 新規struct/unionの全メンバー
- 既存struct/unionの新規メンバーだけ
- 匿名struct/union

### 16.4 コメント

- `@brief`、`@details`、`@param[in,out]`、`@return`、複数`@retval`
- `@note`、`@warning`
- タグ外本文
- 複数コメントブロックと空行の連結
- `/********/`仕切りの除去
- 他の宣言による関連付け打切り
- `///<`、`//!<`、`/**<`
- コメントなしの「記載なし」

### 16.5 サイズ

- 組込み型、ポインタ、enum
- typedefの多段解決
- 一次元・多次元配列
- 整数マクロ式
- structのパディング
- unionの最大サイズ
- `#pragma pack`のpush/pop
- 自己参照ポインタ
- 循環値型、未解決外部型、可変長配列の「算出不可」

### 16.6 Word

生成したdocxのXMLを読み戻し、次を確認する。

- 3章が指定順で存在する。
- 該当なし表示がある。
- 新規関数ごとの詳細表と引数・呼び出し元表がある。
- 新規変数、型、メンバーごとの詳細表がある。
- パス、説明、配列数、サイズが期待値どおりである。
- 第1章の既存変更一覧が維持される。

### 16.7 UIと負荷

`local-samples/load-c-diff`で処理中に次を確認する。

- ウィンドウ移動、モード切替不可状態、中止ボタン、ログスクロールが応答する。
- 進捗表示が更新される。
- 中止操作が受理される。
- MainとRendererのCPU使用が負荷処理ワーカーに比べて低い。
- 既存のExcelブック生成15分以内目標を維持する。

## 17. サンプル

`local-samples`へGit管理外の専用サンプルを追加する。

- Doxygen付き新規関数
- Doxygenなし新規関数
- 複数ファイルからの直接呼び出し
- 新規グローバル変数
- 新規struct/union
- 既存struct/unionへの新規メンバー
- `#pragma pack`
- typedefとマクロ配列数
- 未解決型による「算出不可」
- 連続コメント、仕切り、行末コメント

負荷サンプルには、C解析とWord仕様書生成の処理時間を測定できる数の関数・型を追加する。

## 18. 実装順

1. パラメータ設定、Excel行分類、旧Excel経路削除
2. utility process、JobManager、IPC、中止、成果物ステージング
3. Tree-sitter C WASMのビルド・配布・初期化
4. Cプロジェクト解析モデルと新規判定
5. Doxygen・コメント解析
6. 呼び出し元インデックス
7. MSVC 32bit型サイズ計算
8. Word 3章出力
9. サンプル、負荷試験、終了・中止試験

各段階で自動テストを通し、ワーカー分離後のMainへ負荷処理を戻さない。
