# C/C++ 解析スコープ案

## 1. 目的

この文書は、コード変更と要求・設計整合プレレビューで、拡張機能が AI 投入前に抽出すべき C/C++ の解析対象を定義する。

bob にコード全体の網羅解析を任せるのではなく、機械的に抽出可能な事実を先に整理し、bob には意味的な整合評価を担当させる。

## 2. 基本方針

- 変更差分を起点に解析する。
- 変更されたシンボルと、その周辺影響を段階的に広げる。
- 確定できるもの、候補止まりのもの、不明なものを分ける。
- 関数ポインタ、マクロ、条件コンパイルは過信しない。
- 大規模 C プロジェクトでは完全解析ではなく、レビューに必要な根拠抽出を優先する。

## 3. MVP で抽出するシンボル

| 種別 | 例 | MVP |
|---|---|---:|
| 関数定義 | `int Foo(void)` | yes |
| 関数宣言 | `extern int Foo(void);` | yes |
| typedef | `typedef struct ...` | yes |
| struct / union | `struct Foo` | yes |
| enum | `enum Mode` | yes |
| define 定数 | `#define MAX_COUNT 10` | yes |
| define マクロ関数 | `#define FOO(x)` | warning |
| グローバル変数定義 | `int g_count;` | yes |
| extern 変数宣言 | `extern int g_count;` | yes |
| 関数ポインタ | `(*handler)()` | candidate |
| ファイル static 変数 | `static int s_state;` | yes |

## 4. 変更関数の抽出

### 4.1 出力例

```json
{
  "functions": [
    {
      "id": "FUNC-0001",
      "name": "Foo_HandleTimeout",
      "file": "src/control/foo.c",
      "storage": "static",
      "return_type": "int",
      "parameters": ["FooContext *ctx"],
      "changed_lines": [120, 121, 122],
      "range_after": "100-180",
      "change_type": "modified"
    }
  ]
}
```

### 4.2 判定ルール

- diff の変更行が関数範囲内にある場合、その関数を変更関数とする。
- 関数シグネチャの変更は、呼び出し元影響ありとして扱う。
- 関数削除は、呼び出し元を high priority で抽出する。
- 関数追加は、呼び出し元があるかを確認する。

## 5. 呼び出し関係

### 5.1 MVP 対象

- 変更関数から直接呼んでいる関数
- 変更関数を直接呼んでいる関数
- 同一ファイル内の static 関数呼び出し
- 既存インデックスで解決できる別ファイル呼び出し

### 5.2 出力例

```json
{
  "call_graph": [
    {
      "from": "Foo_Main",
      "to": "Foo_HandleTimeout",
      "confidence": "high",
      "reason": "direct call"
    },
    {
      "from": "Foo_HandleTimeout",
      "to": "Error_SetCode",
      "confidence": "high",
      "reason": "direct call"
    },
    {
      "from": "DispatchTable.handler",
      "to": "Foo_HandleTimeout",
      "confidence": "low",
      "reason": "function pointer candidate"
    }
  ]
}
```

## 6. グローバル変数・共有メモリアクセス

### 6.1 抽出対象

- グローバル変数の読み取り
- グローバル変数の書き込み
- 構造体メンバ単位のアクセス
- 共有メモリ領域の参照
- バックアップ対象変数
- volatile 変数
- extern 宣言された変数

### 6.2 出力例

```json
{
  "data_access": [
    {
      "symbol": "g_systemState.timeoutCount",
      "file": "src/control/foo.c",
      "function": "Foo_HandleTimeout",
      "access": "write",
      "line": 132,
      "confidence": "high"
    }
  ]
}
```

### 6.3 注意点

- ポインタ経由の書き込みは `candidate` とする。
- マクロ経由アクセスは展開前後の両方を保持する。
- メンバ名だけ一致する別構造体を誤結合しない。

## 7. 構造体・I/F 変更影響

### 7.1 構造体変更で抽出する項目

- メンバ追加
- メンバ削除
- 型変更
- 配列長変更
- メンバ順序変更
- typedef 名変更
- pack / align 指定変更

### 7.2 警告にする条件

- 外部 I/F 構造体のサイズが変わる可能性がある。
- 共有メモリ構造体のメンバ順序が変わる。
- ファイル保存構造体の型または配列長が変わる。
- 通信メッセージ構造体が変わる。
- バージョン番号や台帳更新が見つからない。

## 8. define / enum 変更

### 8.1 抽出対象

- 定数値変更
- 定数名変更
- enum 値追加・削除・順序変更
- ビットフラグ値変更
- 配列サイズに使われる define の変更
- タイムアウト、リトライ、閾値、上限下限の変更

### 8.2 bob に渡す観点

- 要求書の範囲・単位と一致しているか。
- 設計書の定数表と一致しているか。
- テストの境界値が追随しているか。
- 外部 I/F の意味が変わっていないか。

## 9. RT / TS 観点のルールチェック

### 9.1 RT 側で警告する処理

- ファイル I/O
- ブロッキング I/O
- 動的メモリ確保
- sleep / wait 系処理
- ログ出力の直接呼び出し
- 重い文字列処理
- ロック待ちの可能性がある処理
- 例外的に時間が読めない処理

### 9.2 TS 側で確認する処理

- RT から依頼された後処理
- ログ出力
- ファイル保存
- メンテナンス処理
- 再計算処理
- UI / 外部連携

## 10. 条件コンパイル

### 10.1 抽出対象

- `#ifdef`
- `#ifndef`
- `#if`
- `#elif`
- `#else`
- `#endif`

### 10.2 方針

- 変更行が条件コンパイル内にある場合、条件式を記録する。
- ビルド構成により有効化されない可能性を warning とする。
- bob には「この構成で有効か」を断定させない。

## 11. 解析結果の分類

| 分類 | 意味 |
|---|---|
| confirmed | 機械的に確定できる |
| candidate | 候補として扱う |
| unknown | 解析できなかった |
| skipped | MVP 範囲外としてスキップ |

## 12. bob に渡す要約

bob に渡す際は、生の解析 JSON だけでなく、Markdown 要約も作る。

```markdown
## 変更コード解析サマリ

- 変更関数: 3
- 変更構造体: 1
- 変更 define: 2
- グローバル変数書き込み変更: 4
- 外部 I/F 影響候補: 1
- RT 禁止処理候補: 0

### 注意が必要な候補

- `SHM_Status.timeoutCount` の書き込み条件が変更されている。
- `ERR_TIMEOUT` の返却分岐が変更されている。
```

## 13. MVP 完了条件

- 変更ファイルを C/C++ とそれ以外に分類できる。
- 変更行が属する関数を抽出できる。
- 変更された define / enum / struct / typedef を抽出できる。
- グローバル変数の読み書き候補を抽出できる。
- 直接呼び出し元・呼び出し先候補を抽出できる。
- RT 禁止処理候補をルールベースで検出できる。
- `changed-symbols.json` と解析サマリ Markdown を生成できる。
