# 3拡張機能修正 リリース証跡

## 1. 対象

| 項目 | 値 |
| --- | --- |
| Pull Request | `#68` |
| Branch | `agent/three-extension-remediation-20260711` |
| Base | `main` / `559929f9e076bce0563de25759ab2cfccb67fb18` |
| 対象拡張 | `workflow-register`、`bob-bazaar-review`、`bob-code-consistency-review` |
| 判定 | **最終検証保留・merge不可** |

本書は、依存契約、provider lifecycle、Git/Bazaar外部プロセス、path境界、processing limit、workflow契約、Windows/Extension Host CIの修正について、リリース前に必要な証跡を一箇所へ集約する。

## 2. 実装済み契約

### 2.1 Dependency / provider lifecycle

- IBM Bobおよびcompanion extensionをsoft dependencyとして扱い、未導入時も通常commandを起動できる。
- providerは`sourceId`を持ち、同一IDの無警告上書きを拒否し、登録解除用Disposableを返す。
- provider登録controllerはAPI identityとgenerationを管理し、stale/late registrationをrollbackする。
- unsuccessful attemptが部分登録を返した場合も全Disposableをrollbackする。
- successful resultにはAPI identityを必須化し、欠落時は登録を破棄して再試行対象とする。
- `workflow-register` API世代が変わらないextension変更では再登録せず、API世代変更時だけ旧登録を解除する。
- provider Disposableはcontrollerだけが所有し、extension contextとの二重所有、二重dispose、旧世代Disposableの蓄積を防ぐ。

### 2.2 Git / Bazaar外部プロセス

- processは`shell: false`、hard timeout、AbortSignal、output budget、process-tree killを使用する。
- timeoutは1,000〜600,000 msへクランプする。
- `timeout`、`cancelled`、`bufferExceeded`、`spawnFailure`、`nonZeroExit`を分類する。
- abort事前確認とlistener登録の間のキャンセル競合を閉じる。
- stdout/stderrの合計保持量は設定byte budgetを超えない。
- timeout/cancel/overflow時はchildの`exit`/`close`、または有限のtermination fallback後にPromiseをsettleする。
- Git revision validationは`nonZeroExit`だけを不正revisionへ正規化し、cancel/timeout等のprocess error kindを保持する。

### 2.3 Path / processing limits

- Bazaar revision/pathはtrim前の制御文字を拒否する。
- pathはPOSIX/Windows absolute、drive-relative、UNC、device path、dot/traversal/empty segmentも拒否する。
- review processing limitはmanifest/runtime共通のmin/default/maxを持つ。
- UTF-8切り詰めsuffixを含め、最終出力をbyte budget内へ収める。

### 2.4 Workflow / VSIX / Extension Host smoke契約

- repository内の対象`WORKFLOW.md`を再帰探索し、provider、preflight、nested command、template mirrorをstrict検証する。
- `.bob/template-library/**/WORKFLOW.md`変更もworkflow contract CIを起動する。
- sample固有の外部commandは、正確なsample pathとworkflow guardrail宣言の両方を満たす場合だけ許可する。
- `.vscode-test.json`は3拡張すべての`.vscodeignore`で除外する。
- VSIX policyは`extension/.vscode-test.json`と`extension/.vscode-test/**`を独立して拒否する。
- dependency policy testはignoreとpackage policyの両方を固定する。
- Extension Host smokeはMochaのBDD interfaceを明示し、`describe`/`it`を使用する。
- smoke設定生成時に、project rootから`@vscode/test-cli`と`@vscode/test-electron`の両方を解決できることをpreflight検査する。
- VSIX生成・policy・metrics完了後に、`@vscode/test-cli@0.0.12`と`@vscode/test-electron@2.5.2`をproject rootへ一時導入する。
- CLIは一時`npx --package`から起動せず、project-localの`node_modules/.bin/vscode-test`を実行する。
- soft dependencyをMarketplaceから暗黙導入しないよう、test configurationで`skipExtensionDependencies: true`を指定する。
- `scripts/extension-host-smoke-contract.test.js`で、package version、local binary、preflight、soft-dependency isolationを固定する。
- 一時的な`extension-host-smoke-diagnostic.yml`は削除し、本体品質workflowへ検証を一本化する。

## 3. 確認済み証跡

### 3.1 過去のGitHub Actions focused test

| 対象 | 結果 | 備考 |
| --- | --- | --- |
| workflow-register provider ownership / duplicate / Disposable | 9 passed / 0 failed | PR conversationへActions botが記録済み |
| bob-bazaar-review path / process runner / provider | 20 passed / 0 failed | PR conversationへActions botが記録済み |
| bob-code-consistency-review full unit suite | 139 passed / 0 failed | PR conversationへActions botが記録済み |

これらは修正途中のcommitでの証跡であり、最新head全体のgreen判定を代替しない。

### 3.2 2026-07-11 局所再現

#### Provider API-generation controller

| Module | 結果 |
| --- | --- |
| `bob-bazaar-review` | 6 passed / 0 failed |
| `bob-code-consistency-review` | 6 passed / 0 failed |

確認内容:

- 同一API identityでは再登録しない。
- unsuccessful partial registrationをrollbackする。
- API generation切替後のstale登録を破棄する。
- deactivate後に完了したlate登録を破棄する。
- API identityなしのsuccessful resultを拒否・rollbackする。
- provider登録はcontrollerだけが所有し、host側のsubscription再disposeでもprovider Disposableを二重実行しない。

両controllerはrepositoryと同じ`target: ES2022`、`module: commonjs`、`strict: true`相当で隔離compileした後、Node.js built-in test runnerで実行した。

#### External process runner

| Module | 結果 |
| --- | --- |
| `bob-bazaar-review` | 9 passed / 0 failed |
| `bob-code-consistency-review` | 9 passed / 0 failed |

確認内容:

- hard timeoutと最低値クランプ。
- 通常キャンセルとpreflight/listener境界キャンセル。
- output overflow分類。
- retained stdout + stderrが設定budget以内。
- overflow rejection時点でchild PIDが残留しない。
- 許可された非zero exit code。
- 拒否された非zero exit codeとstderr保持。

TDD記録:

- RED: 1,024-byte budgetで65,536-byte stream chunkを保持した。
- GREEN: retained stdout + stderrは1,024 bytes以下になった。
- RED: `bufferExceeded` rejection直後にchild PIDが生存していた。
- GREEN: child exit/closeまたは有限fallback後にrejectionするようになった。

#### その他の局所確認

| 検証 | 結果 |
| --- | --- |
| Git cancel分類保持 / invalid ref正規化 | passed |
| Bazaar revision/path trim前制御文字拒否 | passed |
| sample command path-scoped allowlist | passed |
| VSIX `.vscode-test` ignore/policy/dependency-test契約 | 3拡張すべてpassed |
| Extension Host smoke script syntax/config/fake-host | passed |
| smoke harness contract | 3 passed / 0 failed |
| provider API identity typecheck | passed |

局所再現は変更ロジックを隔離した補助証跡であり、repository全体のcompile/testを代替しない。

### 3.3 Extension Host smoke依存の根本原因

`@vscode/test-cli@0.0.12`を使った最小拡張で、CIと同じ`.vscode-test.json`およびsmoke scriptを再現した。

| 段階 | 結果 |
| --- | --- |
| RED | extension projectから`@vscode/test-electron`を解決できず、`Can't resolve '@vscode/test-electron'`で拡張起動前に失敗した。 |
| 原因確認 | test CLIはconfig directoryを起点にElectron runtimeを動的解決する。CLI package側のdevDependencyは利用projectへ自動導入されない。 |
| GREEN境界 | project rootへ必要runtimeを導入すると動的解決を通過し、VS Code download処理まで到達した。 |
| ローカル残制約 | 実行環境のDNS制約により`update.code.visualstudio.com`の名前解決で停止したため、実Extension Hostの完走証跡ではない。 |

最終対応:

1. CIでVSIXを先に生成・検査する。
2. その後にCLI `0.0.12`とElectron runtime `2.5.2`を`--no-save --package-lock=false --ignore-scripts --audit=false --fund=false`でproject rootへ導入する。
3. smoke config生成時に両packageのlocal resolutionを検査する。
4. transientな`npx --package`を廃止し、local binaryを実行する。
5. `skipExtensionDependencies: true`でsoft dependencyの暗黙導入を抑止する。
6. smoke contract testで上記を回帰防止する。

## 4. GitHub Actions runner起動前ブロッカー

### 4.1 第三者Actionを使わないrunner probe

原因をrepository code、checkout、npm、第三者Actionから切り離すため、一時的にechoと`node --version`だけを持つprobeをUbuntu/Windowsで実行した。

| Workflow | Run ID | 結果 |
| --- | ---: | --- |
| `actions-runner-probe` | `29142077414` | Ubuntu/Windowsともstep開始前failure、`steps: null`、logなし |
| `actions-runner-probe` | `29142295720` | Ubuntu/Windowsともstep開始前failure、`steps: null`、logなし |

probeは診断後に削除済みである。

### 4.2 最新観測workflow

最新head `063a6605cc929950a60a13e0c74defe422974370`でも、本体3 workflowはrunner割当前に終了し、修正コード自体はGitHub上でまだ実行されていない。

| Workflow | Run ID | 結果 |
| --- | ---: | --- |
| `extensions-quality` | `29151169155` | Ubuntu/Windowsを含む全jobが`steps: null`、logなし |
| `workflow-contracts` | `29151169138` | validation jobがstep開始前failure |
| `code-consistency-review-scaffold` | `29151169148` | 2 jobともstep開始前failure |

過去の専用smoke診断runも同じ理由でartifactを生成できなかったため、重複する診断workflowは削除した。

checkoutやrepository codeを一切使わないprobeでも再現するため、現在のfailureはworkflow実装やテストコードとは別に、GitHub-hosted runner割当以前のaccount/repository設定にも存在すると判定する。green evidenceが存在しないためmergeは許可しない。

### 4.3 repository管理者が確認する項目

1. GitHub accountのBilling / PlansでActions利用枠、spending limit、支払い状態を確認する。
2. Repository Settings → Actions → GeneralでActionsが許可されていることを確認する。
3. private repositoryでGitHub-hosted Ubuntu/Windows runnerが許可されていることを確認する。
4. 制限解除後、PR #68の最新headで3 workflowを再実行する。
5. jobがstep 1を開始し、job logを生成することを確認する。

## 5. 最新headで必要な自動ゲート

| Gate | 必須結果 | 実績 |
| --- | --- | --- |
| smoke harness contract | pinned local CLI/Electron、local binary、preflight、soft dependency isolation | 局所3 passed、GitHub実行待ち |
| workflow-register Ubuntu | dependency / architecture / source / schema / unit / package / VSIX policy 全成功 | 最新head未実施 |
| bob-bazaar-review Ubuntu | dependency / architecture / source / unused / artifact / unit / package / VSIX policy 全成功 | 最新head未実施 |
| bob-code-consistency-review Ubuntu | dependency / architecture / source / unit / package / VSIX policy 全成功 | 最新head未実施 |
| Windows matrix | 3拡張すべて成功 | 未実施 |
| Extension Host smoke | 3拡張のactivationと代表command登録成功 | local runtime修正済み、GitHub実行待ち |
| workflow contracts | 全対象workflow strict/provider-aware検証成功 | 最新head未実施 |
| code consistency scaffold | scaffoldとVS Code extensionの2 job成功 | 最新head未実施 |

## 6. 実機ゲート

### 6.1 IBM Bob / VS Code

| Case | 手順概要 | 期待結果 | 実績 |
| --- | --- | --- | --- |
| soft dependency | companionを無効化して各拡張を起動 | 通常commandが利用可能 | 未実施 |
| delayed recovery | `workflow-register`を後から有効化 | providerが重複なく登録される | 未実施 |
| API restart | `workflow-register`をreload | 旧providerが解除され新APIへ再登録 | 未実施 |
| step review | review付きworkflowを実行 | reviewing → accept/retryが整合 | 未実施 |
| result handoff | agent結果をcapture providerへ渡す | 既存assistant textからartifact保存 | 未実施 |
| Webview | Bazaar GUI / consistency wizard / Operation Hub | 未処理例外なく表示・操作可能 | 未実施 |

### 6.2 実Bazaar

| Case | 手順概要 | 期待結果 | 実績 |
| --- | --- | --- | --- |
| timeout | 終了しないBazaar wrapperを指定 | 上限時間で`timeout`、子process残留なし | 未実施 |
| cancel | 実行中progressをキャンセル | `cancelled`、子process残留なし | 未実施 |
| path boundary | drive / UNC / device / traversal / control文字を投入 | CLI実行前に拒否 | 未実施 |
| exit code 1 | 差分ありのdiff | 成功扱い | 未実施 |

### 6.3 multi-root

| Case | 手順概要 | 期待結果 | 実績 |
| --- | --- | --- | --- |
| `.bob` / `.bzr`分離 | Bob rootとBazaar rootを別folderにする | rules/resultはBob root、diff/logはBazaar root | 未実施 |
| code consistency VCS root | Bob rootとGit/Bazaar rootを分離 | review packageはBob root、VCS取得は指定root | 未実施 |
| duplicate workflow IDs | 複数rootに同一logical IDを配置 | 登録IDが一意化され衝突しない | 未実施 |

## 7. 最終承認

| 項目 | 記入欄 |
| --- | --- |
| 最新PR head SHA | `063a6605cc929950a60a13e0c74defe422974370` |
| Actions再実行日時 |  |
| Ubuntu合格 |  |
| Windows合格 |  |
| Extension Host合格 |  |
| Workflow contract合格 |  |
| IBM Bob実機担当 / 結果 |  |
| Bazaar実機担当 / 結果 |  |
| multi-root担当 / 結果 |  |
| 未解決リスク | GitHub-hosted runnerがstep開始前に終了する状態、実IBM Bob/Bazaar/multi-root未実施 |
| リリース判定者 |  |
| 判定 | `release / conditional / reject` |

全必須欄が合格するまではPRをdraftのまま維持する。最終mergeは履歴を整理するためsquashを使用する。
