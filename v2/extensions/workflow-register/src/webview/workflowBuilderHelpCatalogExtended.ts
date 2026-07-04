import type { WorkflowBuilderHelpEntry } from "./workflowBuilderHelpTypes"

export const workflowBuilderExtendedHelpCatalog: Record<string, WorkflowBuilderHelpEntry> = {
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
      select: {
        label: "select",
        summary: "選択肢から1つ選ぶ入力です。",
        effect: "入力ミスを減らしたいモード選択に使います。",
        caution: "options が空だと validation error になります。"
      }
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
