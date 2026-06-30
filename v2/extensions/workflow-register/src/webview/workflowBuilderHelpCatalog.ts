export interface WorkflowBuilderHelpOption {
  label: string
  summary: string
  effect: string
  caution?: string
}

export interface WorkflowBuilderHelpEntry {
  id: string
  labelJa: string
  fieldKey: string
  summary: string
  effect: string
  whenToUse?: string
  caution?: string
  example?: string
  related?: string[]
  options?: Record<string, WorkflowBuilderHelpOption>
}

export const workflowBuilderHelpCatalog: Record<string, WorkflowBuilderHelpEntry> = {
  "tab.step": {
    id: "tab.step",
    labelJa: "Step detail",
    fieldKey: "steps[]",
    summary: "選択中 step の種類、実行内容、前後の状態受け渡しを設定します。",
    effect: "ここで指定した内容が workflow の実行順序と Bob / command / manual / result の動作を決めます。",
    whenToUse: "各 step の id、type、prompt、resultKey、includeState を調整したいときに使います。"
  },
  "tab.inputs": {
    id: "tab.inputs",
    labelJa: "Inputs",
    fieldKey: "inputs",
    summary: "ワークフロー開始前にユーザーへ入力してもらう値を定義します。",
    effect: "入力値は step の実行や action provider の引数として利用できます。",
    whenToUse: "レビュー対象パス、出力先、モードなど、実行時に変えたい値がある場合に使います。"
  },
  "tab.requires": {
    id: "tab.requires",
    labelJa: "Requires",
    fieldKey: "requires",
    summary: "このワークフローを実行するための前提条件を定義します。",
    effect: "workspace、Bob バージョン、必要ファイルなどを明示し、実行前の検証に使います。"
  },
  "tab.preflight": {
    id: "tab.preflight",
    labelJa: "Preflight",
    fieldKey: "preflight",
    summary: "本処理に入る前の確認項目を定義します。",
    effect: "必須ファイルや初期化状態など、満たさないと危険な条件を早い段階で検出できます。"
  },
  "tab.artifacts": {
    id: "tab.artifacts",
    labelJa: "Artifacts",
    fieldKey: "artifacts",
    summary: "ワークフローが生成する成果物を定義します。",
    effect: "どの step がどのファイルやディレクトリを生成するかを Bob UI や完了処理から参照しやすくします。"
  },
  "tab.guardrails": {
    id: "tab.guardrails",
    labelJa: "Guardrails",
    fieldKey: "guardrails",
    summary: "command 実行の許可、禁止、人間承認が必要な条件を定義します。",
    effect: "危険な command や外部出力を制御し、ワークフローの安全境界を明確にします。"
  },
  "tab.completion": {
    id: "tab.completion",
    labelJa: "Completion",
    fieldKey: "completion",
    summary: "ワークフロー完了時の summary、成果物表示、結果検証を定義します。",
    effect: "完了後に人間が確認すべき情報や成果物をまとめやすくします。"
  },
  "tab.body": {
    id: "tab.body",
    labelJa: "Markdown Body",
    fieldKey: "WORKFLOW.md body",
    summary: "YAML front matter の後ろに出力される Markdown 本文を編集します。",
    effect: "Bob に渡す目的、手順、注意事項、レビュー観点などを構造化 YAML とは別に記述できます。"
  },
  "tab.preview": {
    id: "tab.preview",
    labelJa: "Preview / Diagnostics",
    fieldKey: "preview",
    summary: "生成される WORKFLOW.md と検証結果を確認します。",
    effect: "保存前に YAML / Markdown の全体像、参照切れ、validation error を確認できます。"
  },
  "meta.name": {
    id: "meta.name",
    labelJa: "ワークフロー名",
    fieldKey: "name",
    summary: "ワークフローの安定識別子です。",
    effect: "保存先フォルダ名や workflow id として使われます。後から変えると既存実行履歴や参照との対応が分かりにくくなります。",
    caution: "英数字、ドット、アンダースコア、ハイフンを推奨します。",
    example: "name: code-consistency-review"
  },
  "meta.title": {
    id: "meta.title",
    labelJa: "表示名",
    fieldKey: "title",
    summary: "Bob UI や一覧に表示する人間向けの名前です。",
    effect: "ワークフロー選択時に見える名称になります。日本語で分かりやすく書けます。",
    example: "title: コード整合プレレビュー"
  },
  "meta.description": {
    id: "meta.description",
    labelJa: "説明",
    fieldKey: "description",
    summary: "ワークフローの目的を短く説明します。",
    effect: "Bob UI、診断、生成される既定 Markdown body の説明として使われます。"
  },
  "meta.workspaceRequired": {
    id: "meta.workspaceRequired",
    labelJa: "ワークスペース必須",
    fieldKey: "workspaceRequired",
    summary: "Bob 実行時に workspace が必要かを指定します。",
    effect: "true にすると workspace 前提のワークフローであることを明示できます。",
    whenToUse: "ファイル読み書き、差分取得、.bob 配下の成果物生成などを行う場合は有効にします。"
  },
  "step.id": {
    id: "step.id",
    labelJa: "Step ID",
    fieldKey: "steps[].id",
    summary: "step を一意に識別する名前です。",
    effect: "artifacts.producedBy や診断メッセージから参照されます。",
    caution: "同じ workflow 内で重複すると validation error になります。"
  },
  "step.type": {
    id: "step.type",
    labelJa: "Step 種別",
    fieldKey: "steps[].type",
    summary: "この step を Bob / command / manual / result のどの方式で実行するかを選びます。",
    effect: "選択した種別によって表示される設定項目と実行方法が変わります。",
    options: {
      agent: { label: "agent", summary: "Bob / agent に prompt を渡して処理させます。", effect: "分析、要約、レビュー、文章生成など AI に考えさせる処理に使います。" },
      command: { label: "command", summary: "VS Code command または action provider を実行します。", effect: "差分収集、ファイル生成、検証、外部ツール連携など拡張機能側で行う処理に使います。" },
      manual: { label: "manual", summary: "人間の確認完了を待つ step です。", effect: "承認、目視確認、手動作業の完了待ちを workflow に含められます。" },
      result: { label: "result", summary: "state や固定文字列を成果物へ書き出します。", effect: "前段 step の結果をファイルや result sink に保存したいときに使います。" }
    }
  },
  "step.title": {
    id: "step.title",
    labelJa: "Step 表示名",
    fieldKey: "steps[].title",
    summary: "人間が読む step の名前です。",
    effect: "Bob UI や step 一覧で表示されます。"
  },
  "step.required": {
    id: "step.required",
    labelJa: "必須 step",
    fieldKey: "steps[].required",
    summary: "この step を成功必須として扱うかを指定します。",
    effect: "重要な前処理、検証、成果物生成など、失敗時に続行すべきでない step で有効にします。"
  },
  "step.stateRequired": {
    id: "step.stateRequired",
    labelJa: "State 必須",
    fieldKey: "steps[].stateRequired",
    summary: "includeState で指定した前段結果が無い場合に実行しないことを示します。",
    effect: "前段の分析結果や生成物が必要な step で、誤って空の状態で進むことを防ぎます。"
  },
  "step.resultKey": {
    id: "step.resultKey",
    labelJa: "結果名",
    fieldKey: "steps[].resultKey",
    summary: "この step の結果を workflow state に保存する名前です。",
    effect: "後続 step は includeState でこの名前を選ぶと、前の結果を参照できます。",
    caution: "分かりにくい名前にすると、後続 step や artifacts との関係が追いづらくなります。"
  },
  "step.includeState": {
    id: "step.includeState",
    labelJa: "前段結果の取り込み",
    fieldKey: "steps[].includeState",
    summary: "前の step が保存した resultKey を、この step に渡します。",
    effect: "AI step や command step が、前段の出力を根拠や入力として使えるようになります。",
    caution: "まだ生成されていない resultKey を参照すると、参照順序の error になります。"
  },
  "step.maxResultBytes": {
    id: "step.maxResultBytes",
    labelJa: "結果サイズ上限",
    fieldKey: "steps[].maxResultBytes",
    summary: "step 結果として保持する最大バイト数です。",
    effect: "大きすぎる出力を state や Bob context に入れないように制限できます。"
  },
  "command.provider": {
    id: "command.provider",
    labelJa: "Command provider",
    fieldKey: "steps[].action.provider",
    summary: "command step で呼び出す action provider です。",
    effect: "他拡張が workflow-register に登録した provider ID、または VS Code command 実行 provider を指定します。"
  },
  "command.commandId": {
    id: "command.commandId",
    labelJa: "VS Code command ID",
    fieldKey: "steps[].action.args[0]",
    summary: "vscode.executeCommand 経由で実行する command ID です。",
    effect: "provider が vscode.executeCommand の場合、この値が実際に実行される command になります。"
  },
  "command.extraArgs": {
    id: "command.extraArgs",
    labelJa: "追加引数",
    fieldKey: "steps[].action.args[]",
    summary: "command に渡す追加引数を JSON array で指定します。",
    effect: "固定オプションを command へ渡したい場合に使います。",
    caution: "JSON として不正な場合、GUI 上では反映されない可能性があります。"
  },
  "step.sendResult": {
    id: "step.sendResult",
    labelJa: "結果を送信",
    fieldKey: "steps[].sendResult",
    summary: "command 実行結果を Bob 側へ送るかを指定します。",
    effect: "true にすると前処理や検証の結果を Bob の会話・state に渡しやすくなります。"
  },
  "step.completeOnSuccess": {
    id: "step.completeOnSuccess",
    labelJa: "成功時に完了扱い",
    fieldKey: "steps[].completeOnSuccess",
    summary: "command 成功時に step を自動完了するかを指定します。",
    effect: "前処理や保存など、人間確認なしで次へ進める command step で使います。"
  },
  "result.source": {
    id: "result.source",
    labelJa: "Result source",
    fieldKey: "steps[].result.source",
    summary: "成果物へ書き出す元データを選びます。",
    effect: "state、固定文字列、agent 出力のどれを sink に渡すかが変わります。",
    options: {
      state: { label: "state", summary: "前段 step の resultKey を書き出します。", effect: "既に workflow state に保存された結果をファイル化したい場合に使います。" },
      literal: { label: "literal", summary: "画面で入力した固定文字列を書き出します。", effect: "定型文や固定テンプレートを成果物として保存したい場合に使います。" },
      agent: { label: "agent", summary: "agent の出力を成果物として扱います。", effect: "AI が生成した内容を sink へ渡す前提の step で使います。" }
    }
  },
  "result.stateKey": {
    id: "result.stateKey",
    labelJa: "State key",
    fieldKey: "steps[].result.stateKey",
    summary: "書き出し元にする workflow state の resultKey です。",
    effect: "選択した前段結果を file sink などへ保存します。"
  },
  "result.text": {
    id: "result.text",
    labelJa: "固定テキスト",
    fieldKey: "steps[].result.text",
    summary: "literal source の場合に書き出す固定文字列です。",
    effect: "定型の Markdown や補足文を成果物として出力できます。"
  },
  "result.path": {
    id: "result.path",
    labelJa: "出力パス",
    fieldKey: "steps[].result.sinks[].path",
    summary: "result を保存するファイルパスです。",
    effect: "workspace root 配下の成果物ファイルとして書き出します。",
    caution: "ワークスペース外へ逃げる path は実行時に拒否される想定です。"
  },
  "input.id": {
    id: "input.id",
    labelJa: "入力 ID",
    fieldKey: "inputs.<id>",
    summary: "実行時入力を識別する名前です。",
    effect: "step や action provider がこの ID で入力値を参照します。"
  },
  "input.type": {
    id: "input.type",
    labelJa: "入力種別",
    fieldKey: "inputs.<id>.type",
    summary: "ユーザーに入力してもらう値の種類です。",
    effect: "入力 UI と validation の前提が変わります。",
    options: {
      string: { label: "string", summary: "文字列入力です。", effect: "パス、ID、説明文など自由入力に使います。" },
      number: { label: "number", summary: "数値入力です。", effect: "上限値や件数など数値として扱う項目に使います。" },
      boolean: { label: "boolean", summary: "true / false の入力です。", effect: "有効/無効の切り替えに使います。" },
      select: { label: "select", summary: "選択肢から1つ選ぶ入力です。", effect: "入力ミスを減らしたいモード選択に使います。", caution: "options が空だと validation error になります。" }
    }
  },
  "input.title": {
    id: "input.title",
    labelJa: "入力表示名",
    fieldKey: "inputs.<id>.title",
    summary: "ユーザーに表示する入力項目名です。",
    effect: "日本語で分かりやすく書くと、実行時の入力ミスを減らせます。"
  },
  "input.required": {
    id: "input.required",
    labelJa: "必須入力",
    fieldKey: "inputs.<id>.required",
    summary: "この入力を必須にするかを指定します。",
    effect: "true にすると未入力のまま workflow を開始しにくくなります。"
  },
  "input.options": {
    id: "input.options",
    labelJa: "選択肢",
    fieldKey: "inputs.<id>.options",
    summary: "select 入力で表示する選択肢です。",
    effect: "1行1項目で指定し、ユーザーはその中から選びます。"
  },
  "requires.workspace": {
    id: "requires.workspace",
    labelJa: "workspace 必須",
    fieldKey: "requires.workspace",
    summary: "実行に VS Code workspace が必要かを示します。",
    effect: "true にすると、ファイル操作や .bob 配下成果物生成が前提であることを明示できます。"
  },
  "requires.bobMinVersion": {
    id: "requires.bobMinVersion",
    labelJa: "Bob 最小バージョン",
    fieldKey: "requires.bob.minVersion",
    summary: "必要な IBM Bob の最小バージョンです。",
    effect: "古い Bob では動かない workflow で、利用者に前提を示します。",
    example: "requires:\n  bob:\n    minVersion: \"2.0.0\""
  },
  "requires.files": {
    id: "requires.files",
    labelJa: "必要ファイル",
    fieldKey: "requires.files",
    summary: "実行前に存在してほしいファイルや glob です。",
    effect: "review-input.yaml や設定ファイルなど、無いと失敗する入力を明示できます。"
  },
  "preflight.id": {
    id: "preflight.id",
    labelJa: "Preflight ID",
    fieldKey: "preflight[].id",
    summary: "preflight check を識別する名前です。",
    effect: "診断や後続の説明で、どの事前確認かを示します。"
  },
  "preflight.failurePolicy": {
    id: "preflight.failurePolicy",
    labelJa: "失敗時の扱い",
    fieldKey: "preflight[].failurePolicy",
    summary: "preflight に失敗したときに workflow を止めるか、警告にするかを選びます。",
    effect: "必須条件か参考条件かによって、実行継続の判断を変えられます。",
    options: {
      stop: { label: "stop", summary: "失敗したら停止します。", effect: "必須ファイルや初期化状態など、満たさないと続行できない条件に使います。" },
      continue: { label: "continue", summary: "失敗しても続行します。", effect: "任意の確認や、後続で再確認できる条件に使います。" },
      warn: { label: "warn", summary: "警告として扱います。", effect: "注意喚起はしたいが停止までは不要な条件に使います。" }
    }
  },
  "preflight.title": {
    id: "preflight.title",
    labelJa: "Preflight 表示名",
    fieldKey: "preflight[].title",
    summary: "事前確認の人間向け名称です。",
    effect: "診断やレビュー時に内容を理解しやすくします。"
  },
  "preflight.required": {
    id: "preflight.required",
    labelJa: "必須確認",
    fieldKey: "preflight[].required",
    summary: "この preflight を必須扱いにするかを指定します。",
    effect: "重要な前提条件として明示できます。"
  },
  "preflight.checks": {
    id: "preflight.checks",
    labelJa: "Check ID",
    fieldKey: "preflight[].checks",
    summary: "実行したい check の識別子です。",
    effect: "workflow 側で用意された事前確認処理を参照します。"
  },
  "preflight.files": {
    id: "preflight.files",
    labelJa: "確認ファイル",
    fieldKey: "preflight[].files",
    summary: "preflight で確認するファイルや glob です。",
    effect: "必要ファイルの存在やレビュー対象ファイルの有無を事前に確認できます。"
  },
  "artifact.id": {
    id: "artifact.id",
    labelJa: "成果物 ID",
    fieldKey: "artifacts[].id",
    summary: "成果物を識別する名前です。",
    effect: "completion や人間レビューで成果物を参照しやすくします。"
  },
  "artifact.producedBy": {
    id: "artifact.producedBy",
    labelJa: "生成元 step",
    fieldKey: "artifacts[].producedBy",
    summary: "この成果物を生成する step の id です。",
    effect: "step と成果物の対応を明確にします。存在しない step を選ぶと参照エラーになります。"
  },
  "artifact.path": {
    id: "artifact.path",
    labelJa: "成果物パス",
    fieldKey: "artifacts[].path",
    summary: "成果物の保存先ファイルまたはディレクトリです。",
    effect: "完了時 summary や artifacts 表示で参照されます。"
  },
  "guardrails.allowedCommands": {
    id: "guardrails.allowedCommands",
    labelJa: "許可 command",
    fieldKey: "guardrails.allowedCommands",
    summary: "実行を許可する command provider の一覧です。",
    effect: "空でなければ、ここにある command だけを許可する allow list として働きます。",
    caution: "deniedCommands と同じ command を書くと validation error になります。"
  },
  "guardrails.deniedCommands": {
    id: "guardrails.deniedCommands",
    labelJa: "禁止 command",
    fieldKey: "guardrails.deniedCommands",
    summary: "実行を禁止する command provider の一覧です。",
    effect: "shell 実行やワークスペース外書き込みなど、危険な操作を明示的に拒否できます。"
  },
  "approval.id": {
    id: "approval.id",
    labelJa: "承認ルール ID",
    fieldKey: "guardrails.requireApproval[].id",
    summary: "人間承認ルールを識別する名前です。",
    effect: "診断やレビュー時に、どの承認条件かを区別しやすくします。"
  },
  "approval.when": {
    id: "approval.when",
    labelJa: "承認条件",
    fieldKey: "guardrails.requireApproval[].when",
    summary: "どのような場合に人間承認が必要かを表す条件です。",
    effect: "変更ファイル数が多い、外部出力がある、危険 command を使うなどの条件を説明できます。",
    caution: "現時点では条件式を厳密評価するというより、承認が必要な状況を workflow 定義に残すための項目です。",
    example: "when: \"reviewContext.changedFiles.count > 100\""
  },
  "approval.message": {
    id: "approval.message",
    labelJa: "承認メッセージ",
    fieldKey: "guardrails.requireApproval[].message",
    summary: "承認が必要な理由を人間に伝える文です。",
    effect: "レビュー担当者がなぜ止まっているのか、何を確認すべきかを理解しやすくします。"
  },
  "completion.summary": {
    id: "completion.summary",
    labelJa: "完了 summary",
    fieldKey: "completion.summary",
    summary: "ワークフロー完了時に表示・生成する summary の方針です。",
    effect: "完了後にどのようなまとめを出すかを示します。"
  },
  "completion.includeArtifacts": {
    id: "completion.includeArtifacts",
    labelJa: "成果物を含める",
    fieldKey: "completion.includeArtifacts",
    summary: "完了 summary に artifacts を含めるかを指定します。",
    effect: "true にすると、人間が確認すべき出力ファイルやディレクトリを見つけやすくなります。"
  },
  "completion.validateResult": {
    id: "completion.validateResult",
    labelJa: "結果検証",
    fieldKey: "completion.validateResult",
    summary: "完了時に結果検証を行う前提かを指定します。",
    effect: "Bob 出力や成果物を schema / evidence と照合するワークフローで有効にします。"
  },
  "completion.visualizationType": {
    id: "completion.visualizationType",
    labelJa: "可視化種別",
    fieldKey: "completion.visualization.type",
    summary: "完了結果をどの形式で可視化するかを示します。",
    effect: "Markdown、table、mermaid など、成果物の見せ方を指定できます。"
  },
  "completion.visualizationEnabled": {
    id: "completion.visualizationEnabled",
    labelJa: "可視化を有効化",
    fieldKey: "completion.visualization.enabled",
    summary: "完了時の visualization を有効にするかを指定します。",
    effect: "true にすると、summary だけでなく図表や構造化表示を使う前提になります。"
  },
  "body.body": {
    id: "body.body",
    labelJa: "Markdown 本文",
    fieldKey: "WORKFLOW.md body",
    summary: "YAML front matter の後ろに出力される自由記述の Markdown です。",
    effect: "Bob に渡す目的、手順、レビュー観点、注意事項を人間が読みやすい形で記述できます。"
  }
}
