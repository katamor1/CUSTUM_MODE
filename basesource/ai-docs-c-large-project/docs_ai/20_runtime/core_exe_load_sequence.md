# Core EXE DLLロードシーケンス

## 目的

コアEXEが起動時にPEロードするDLL、ロード順、初期化関数、失敗時挙動を整理する。

## 調査項目

- LoadLibrary / GetProcAddress / 独自PEロード処理
- DLLロード順
- DLL初期化関数
- 初期化失敗時の戻り値・ログ・復旧処理
- 共有メモリ初期化との関係

## 未確認事項

- コアEXE名
- DLLロード方式の実装箇所
