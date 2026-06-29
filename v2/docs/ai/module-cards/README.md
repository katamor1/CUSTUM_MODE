# AI向け Module Card テンプレート

このディレクトリは、大規模 C/C++ / DLL 構成のコードベースを AI が調査・設計・レビュー・テスト支援しやすくするための `Module Card` テンプレート群を定義する。

## 目的

`Module Card` は、AI がモジュールを調査するときの最初の地図として使う。

特に以下を明確にする。

- モジュールの責務
- 入口関数・出口関数
- 他 DLL / 共有ヘッダ / 共有メモリ / ファイル / メッセージとの接点
- 主要データと更新責任
- 変更時に危険な箇所
- 参照すべき詳細カード

## モジュール分類

モジュールの規模に応じて、同じテンプレートを無理に適用しない。

| Class | 対象 | 作成単位 |
|---|---|---|
| Class A: 通常モジュール | 1 枚の Module Card で全体像を説明できる DLL / DSP | `module-card-template.md` 1 枚 |
| Class B: 複合モジュール | 複数の主要 I/F、共有データ、処理群を持つ DLL / DSP | Module Card + Interface Card / Data Card 数枚 |
| Class C: 巨大/カーネル系モジュール | 大量スレッド、大量グローバル、大量 export / extern を持つ DLL | Top Module Card + 下位カード群 |

## Class C の判定目安

以下のいずれかに該当する場合、通常の Module Card へ全情報を詰め込まない。

- スレッドエントリポイントが多数ある
- DLL 外 export 関数が数十〜百単位で存在する
- DLL 内 extern 関数が数百〜千単位で存在する
- グローバル変数領域が巨大で、構造体メンバ単位では人手列挙が困難
- 複数スレッド、複数 DLL、共有メモリ、バックアップ領域が密結合している
- 1 ファイルの Module Card が索引として使えないほど肥大化する

## Class C の基本方針

巨大 DLL / カーネル系 DLL では、Top Module Card は「説明書」ではなく「地図 + 索引 + 危険標識」として扱う。

```text
巨大DLL用 Top Module Card
  ├─ Thread Entry Card 群
  ├─ Export API Card 群
  ├─ Internal Function Group Card 群
  ├─ Global Data Area Card 群
  ├─ Initialization / Shutdown Card
  ├─ Critical Flow Card 群
  └─ Change Risk / Test Strategy Card
```

## 推奨ファイル構成

```text
docs/ai/modules/<module-id>/
  00_module_card.md
  01_thread_index.md
  02_export_api_index.md
  03_internal_function_groups.md
  04_global_data_areas.md
  05_initialization_shutdown.md
  06_change_risk_map.md
  07_test_strategy.md

  threads/
    thread_001_<name>.md
    thread_002_<name>.md

  api_groups/
    api_init.md
    api_status.md
    api_backup.md
    api_diagnostic.md

  data_areas/
    data_status.md
    data_backup.md
    data_shared_memory.md
    data_error.md

  flows/
    flow_startup.md
    flow_shutdown.md
    flow_backup.md
    flow_error_notify.md
```

## 作成優先順位

巨大モジュールでは、すべてを一気に詳細化しない。

まず以下の 3 つを作成する。

1. `00_module_card.md`
2. `01_thread_index.md`
3. `04_global_data_areas.md`

その後、以下の順で詳細化する。

1. 起動・初期化に関わる処理
2. 複数 DLL から呼ばれる export API
3. 複数スレッドが読み書きするグローバルデータ
4. 共有メモリ / バックアップ対象データ
5. 過去不具合や変更頻度が高い処理
6. その他の内部関数

## テンプレート一覧

| テンプレート | 用途 |
|---|---|
| `module-card-template.md` | Class A / B 向けの基本 Module Card |
| `huge-module-card-template.md` | Class C 向けの Top Module Card と下位カード群 |
