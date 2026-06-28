作成しました。
前回のMVP-1用Issueに加えて、着手口として必要な **Phase 0運用ルール確定Issue** も作成したので、合計 **8件** です。

|  # | Issue                                     |
| -: | ----------------------------------------- |
| #1 | `[AI Docs] Phase 0: 運用ルールを確定する`           |
| #2 | `[AI Docs] 2 dsw / 48 dsp のビルド台帳を生成する`    |
| #3 | `[AI Docs] DLL出力一覧を生成する`                  |
| #4 | `[AI Docs] include path / define 一覧を生成する` |
| #5 | `[AI Docs] 共有ヘッダ候補を抽出する`                  |
| #6 | `[AI Docs] 重要DLL 3個を選定する`                 |
| #7 | `[AI Docs] 重要DLL 3個のModule Card初稿を作成する`   |
| #8 | `[AI Docs] AI生成物レビュー記録テンプレートを確定する`        |

各Issueには `ai-docs` と `needs-human-review` ラベルも付いています。

次はこの順番で進めるのがよいです。

```text
1. #1 を着手して Phase 0 のルールを確定
2. progress/status.json を phase0_in_progress に更新
3. ai-docs/phase0-rules ブランチを作成
4. #1 対応PRを作成
5. #2〜#4 で dsw/dsp 解析に入る
```

次は **Phase 0用ブランチ作成と status.json 更新** を行うのが自然です。
