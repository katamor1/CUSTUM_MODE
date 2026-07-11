# 3拡張機能修正 継続レビュー証跡

## 1. 位置づけ

本書は `three-extension-remediation-2026-07-11.md` の継続証跡である。初回修正後の横断再レビューで見つかった、provider解除所有権、Webview破棄、path正規化、Git差分parser、VCS process buffer、workflow provider catalogを記録する。

| 項目 | 値 |
| --- | --- |
| Pull Request | `#68` |
| Branch | `agent/three-extension-remediation-20260711` |
| 証跡対象head | `3c85013226434a265830f0b34a3b3380f50443ea` |
| 判定 | **実装済み・最新head全体CIおよび実機検証待ち** |

## 2. 継続レビューで修正した事項

### 2.1 Provider lifecycle

- companion extensionのprovider Disposableをretry controllerとextension contextが二重所有していた構造を解消した。
- provider Disposableはcontrollerだけが所有する。
- API generation切替、partial registration、stale completion、deactivate後late completion、API identity欠落をrollbackする。
- `workflow-register` serviceは解除済みprovider registrationを追跡集合から即時除去する。
- service shutdown時は残存registrationを逆順で全解除し、1件の例外が後続cleanupを止めない。

### 2.2 Webview lifecycle

- Manual Step Panel controllerへ明示的な`dispose()`を追加した。
- panel、message subscription、panel-dispose subscriptionを1回だけ解除する。
- service deactivation時にpanelを閉じ、破棄後の再表示を拒否する。

### 2.3 Bazaar / generated artifact / changed-file path

- Bazaar相対pathの外側空白とNBSPを、別pathへtrimせず拒否する。
- コード整合レビューのchanged-file pathも外側空白を拒否し、Windows separatorだけを安全にPOSIXへ変換する。
- 生成物pathは、外側空白、segment前後空白、`.`、空segment、制御文字を拒否する。
- Bazaar revisionは両拡張で制御文字をtrim前に拒否する。
- diff fixture内の`files[].path`にも実VCSと同じ厳格path契約を適用する。

### 2.4 Git差分parser

- `git diff --name-status`と`--numstat`をNUL区切り（`-z`）へ変更した。
- rename/copyのold/new pathを明示的に解析する。
- 空白を含むrename先pathとnumstatを正しく対応付ける。
- 実在する`a/`、`b/`directory prefixをGit diff headerの仮想prefixと誤認して除去しない。
- タブ、改行、NUL等の制御文字を含むpathは、quoted aliasとして受理せず明示的に拒否する。

### 2.5 VCS process buffer

- Git/Bazaar差分取得の固定20MiB/50MiB bufferを廃止した。
- `maxRawDiffBytes`の2倍＋64KiBからprocess hard bufferを導出する。
- 最低1MiB、最大20MiBへクランプする。
- 既定`maxRawDiffBytes=1MiB`ではprocess bufferは2MiB＋64KiBとなる。
- 最大`maxRawDiffBytes=10MiB`でもprocess bufferは20MiBを超えない。

### 2.6 Workflow provider catalog

- `docs/workflows/action-provider-contracts.json`をaction provider IDの正本とした。
- workflow strict validationはcatalogだけを許可一覧として使用する。
- catalog 22 IDと実装登録IDを完全一致比較する。
- 実装ファイルへ無関係な`id`が追加された場合、許可一覧が暗黙拡大せずcatalog mismatchでCIを失敗させる。
- catalogとmechanical provider実装の変更でも`workflow-contracts`を起動する。

## 3. 局所検証結果

| 検証 | 結果 | 内容 |
| --- | ---: | --- |
| Bazaar provider retry controller | 6 passed / 0 failed | generation、partial/stale/late、API identity、単一所有 |
| Code consistency provider retry controller | 6 passed / 0 failed | generation、partial/stale/late、API identity、単一所有 |
| Action provider registration store | 3 passed / 0 failed | 手動解除、例外継続cleanup、shutdown後登録拒否 |
| Manual Step Panel lifecycle | 1 passed / 0 failed | panel/listenerをexactly onceで破棄 |
| Bazaar path boundary focused assertions | 8 passed / 0 failed | Windows/POSIX、control、outer whitespace |
| Changed-file path boundary | 5 passed / 0 failed | inner space保持、outer whitespace拒否 |
| Generated artifact path boundary | 13 passed / 0 failed | control、dot/empty、segment whitespace |
| Latest Git collector strict compile | passed | `target: ES2022`、CommonJS、strict相当 |
| Latest Git collector real-repository integration | 4 passed / 0 failed | a/b prefix、rename+space、control path、fixture path |
| VCS buffer / UTF-8 limit | 2 passed / 0 failed | min/default/max buffer、UTF-8 byte上限 |
| Provider catalog comparison | 22 / 22 IDs | catalogと実装登録IDが完全一致 |
| Extension Host smoke contract | 3 passed / 0 failed | pinned runtime、local binary、preflight、soft dependency isolation |

局所検証は変更境界の補助証跡であり、最新head全体の`npm ci`、compile、全unit、VSIX、Windows、Extension Host、workflow contractsを代替しない。

## 4. 最新GitHub Actions観測

head `3c85013226434a265830f0b34a3b3380f50443ea`では次のrunが作成された。

| Workflow | Run ID | 結果 |
| --- | ---: | --- |
| `extensions-quality` | `29152701313` | 全7 jobが`steps: null`、`logs_url: null` |
| `workflow-contracts` | `29152701348` | step開始前failure |
| `code-consistency-review-scaffold` | `29152701371` | step開始前failure |

checkout、npm、repository codeを使わないUbuntu/Windows probeでも同じ症状を再現済みであるため、現在の自動検証blockerはrepository codeとは別に、private repositoryのActions利用枠、spending limit、billing状態、またはGitHub-hosted runner許可設定にあると判断する。

## 5. 残存ゲート

- [ ] `extensions-quality` Ubuntu 3 job成功
- [ ] `extensions-quality` Windows 3 job成功
- [ ] 3拡張の実VS Code Extension Host activation smoke成功
- [ ] 全workflow strict/provider-aware contract成功
- [ ] code consistency scaffold 2 job成功
- [ ] IBM Bob実環境でsoft dependency、delayed recovery、API restart、step review、result handoff、Webviewを確認
- [ ] 実Bazaar環境でtimeout/cancel後のchild process非残留を確認
- [ ] multi-rootでBob rootとVCS rootの分離を確認
- [ ] 最終head SHAと全結果を主release evidenceへ反映

## 6. 現在の判断

主要なHigh/Medium修正と追加横断レビューのコード変更は完了している。最新headの全体CIと実機証跡が存在しないため、PR #68はdraftを維持し、merge/releaseを許可しない。
