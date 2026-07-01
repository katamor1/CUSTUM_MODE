# Workflow Builder Guided Help 実装メモ

このメモは、Workflow Builder の設定支援強化の実装内容を補足する。

## Help Target

重要な入力要素には描画時点で `data-help-id` を付ける。

後付け DOM 推定は残すが、主要項目は明示指定を優先する。

## Step Type Guide

`Step detail` の上部に、選択中 step type に応じた設定順 guide を表示する。

## Option Label

select option の値は従来通りにし、表示だけ説明付きにする。

## Diagnostics Link

Diagnostics と参照チェックには、関連設定へ移動するリンクを付ける。
