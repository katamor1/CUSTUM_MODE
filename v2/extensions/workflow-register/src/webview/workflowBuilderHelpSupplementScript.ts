export function renderWorkflowBuilderHelpCatalogSupplementScript(): string {
  return String.raw`
Object.assign(helpCatalog, {
  'tab.branching': { id: 'tab.branching', labelJa: 'Branching', fieldKey: 'branching', summary: '条件分岐と step-back loop を定義します。', effect: 'transition で前の step へ戻る場合に loop ID、entryStep、反復上限、checkpoint 文言を明示できます。' },
  'input.requiredWhen': { id: 'input.requiredWhen', labelJa: '条件付き必須', fieldKey: 'inputs.<id>.requiredWhen', summary: '他の input 値に応じて、この input を必須にする条件式です。', effect: 'モード依存の入力条件を workflow 定義へ残せます。', caution: 'validator は参照先 input の存在を確認します。未対応の式は warning になります。' },
  'input.prompt': { id: 'input.prompt', labelJa: '開始時に尋ねる', fieldKey: 'inputs.<id>.prompt', summary: 'workflow 開始時にユーザーへ入力を促す対象かを指定します。', effect: '実行前入力 UI で値を集める前提を明示できます。' },
  'input.defaultJson': { id: 'input.defaultJson', labelJa: '既定値', fieldKey: 'inputs.<id>.default', summary: 'input の既定値です。GUI では JSON として編集します。', effect: 'string / number / boolean / null の型を保ったまま保存できます。', caution: '文字列は引用符付き JSON で入力してください。' },
  'artifact.schema': { id: 'artifact.schema', labelJa: '成果物 schema', fieldKey: 'artifacts[].schema', summary: '成果物の形式や検証 schema を表す任意の識別子です。', effect: 'completion.validateResult などで成果物の期待形を説明しやすくなります。' },
  'branching.enabled': { id: 'branching.enabled', labelJa: 'Branching 有効化', fieldKey: 'branching.enabled', summary: 'step transition による分岐を有効にします。', effect: 'transition を使う workflow では true にする必要があります。' },
  'branching.loop.id': { id: 'branching.loop.id', labelJa: 'Loop ID', fieldKey: 'branching.loops[].id', summary: 'backward goto で参照する loop の識別子です。', effect: 'transition.decisions[].loop から参照され、反復回数の制御に使われます。' },
  'branching.loop.entryStep': { id: 'branching.loop.entryStep', labelJa: 'Loop entryStep', fieldKey: 'branching.loops[].entryStep', summary: 'loop の開始 step です。', effect: 'backward goto は、この entryStep を指す必要があります。' },
  'branching.loop.title': { id: 'branching.loop.title', labelJa: 'Loop 表示名', fieldKey: 'branching.loops[].title', summary: 'loop を人間に説明する名称です。', effect: 'checkpoint や診断で loop の目的を理解しやすくします。' },
  'branching.loop.maxIterations': { id: 'branching.loop.maxIterations', labelJa: '最大反復回数', fieldKey: 'branching.loops[].maxIterations', summary: 'loop を何回まで繰り返せるかを指定します。', effect: '無限に戻り続けることを防ぎます。' },
  'branching.loop.extensionSize': { id: 'branching.loop.extensionSize', labelJa: '延長単位', fieldKey: 'branching.loops[].extensionSize', summary: 'checkpoint で反復回数を延長するときの単位です。', effect: '人間承認により追加試行を許可する設計にできます。' },
  'branching.loop.checkpointTitle': { id: 'branching.loop.checkpointTitle', labelJa: 'Checkpoint タイトル', fieldKey: 'branching.loops[].checkpoint.title', summary: 'loop 上限到達時に表示する checkpoint 名です。', effect: '利用者に、なぜ workflow が止まったのかを伝えやすくします。' },
  'branching.loop.checkpointMessage': { id: 'branching.loop.checkpointMessage', labelJa: 'Checkpoint メッセージ', fieldKey: 'branching.loops[].checkpoint.message', summary: 'loop 上限到達時に表示する確認文です。', effect: '延長、調査、中止の判断に必要な観点を示せます。' },
  'section.branchCheckpoint': { id: 'section.branchCheckpoint', labelJa: 'Checkpoint', fieldKey: 'branching.loops[].checkpoint', summary: 'loop が上限に達したときの人間確認設定です。', effect: '反復を続けるか、中止するかを人間が判断しやすくします。' },
  'section.manualForm': { id: 'section.manualForm', labelJa: 'Manual Form', fieldKey: 'steps[].form', summary: 'manual step で利用者から値を受け取るフォームです。', effect: '入力結果を form.resultKey に保存し、後続 step の state として利用できます。' },
  'manual.form.resultKey': { id: 'manual.form.resultKey', labelJa: 'Form resultKey', fieldKey: 'steps[].form.resultKey', summary: 'フォーム回答を workflow state に保存する名前です。', effect: '後続 step の includeState や result.source=state から参照できます。' },
  'manual.form.fieldsJson': { id: 'manual.form.fieldsJson', labelJa: 'Form fields JSON', fieldKey: 'steps[].form.fields', summary: 'manual form の fields 配列を JSON で編集します。', effect: 'id / title / type / required / multiline / options を field ごとに定義できます。', caution: 'type は string / number / boolean / select のいずれかです。select では options を指定してください。' },
  'section.manualApproval': { id: 'section.manualApproval', labelJa: 'Manual Approval', fieldKey: 'steps[].approval', summary: 'manual step で承認・却下の判断を記録する設定です。', effect: '承認結果を approval.resultKey に保存し、後続分岐や state 参照に使えます。' },
  'manual.approval.resultKey': { id: 'manual.approval.resultKey', labelJa: 'Approval resultKey', fieldKey: 'steps[].approval.resultKey', summary: '承認結果を workflow state に保存する名前です。', effect: 'transition.when.stateKey から承認結果を見て分岐できます。' },
  'manual.approval.approveLabel': { id: 'manual.approval.approveLabel', labelJa: '承認ボタン文言', fieldKey: 'steps[].approval.approveLabel', summary: '承認ボタンに表示する文言です。', effect: '承認の意味を step に合わせて明確にできます。' },
  'manual.approval.rejectLabel': { id: 'manual.approval.rejectLabel', labelJa: '却下ボタン文言', fieldKey: 'steps[].approval.rejectLabel', summary: '却下ボタンに表示する文言です。', effect: '却下時に戻す、修正する、中止するなどの意味を明確にできます。' },
  'manual.approval.message': { id: 'manual.approval.message', labelJa: '承認メッセージ', fieldKey: 'steps[].approval.message', summary: '承認者へ表示する説明文です。', effect: '何を確認して承認または却下すべきかを明示します。' },
  'section.transition': { id: 'section.transition', labelJa: 'Transition', fieldKey: 'steps[].transition', summary: 'step 完了後の分岐先を定義します。', effect: 'stateKey の値に応じて goto、loop、default を切り替えられます。' },
  'transition.default': { id: 'transition.default', labelJa: 'Default transition', fieldKey: 'steps[].transition.default', summary: 'どの decision にも一致しない場合の遷移先です。', effect: 'next / end / fail または step id を指定できます。' },
  'transition.decisions': { id: 'transition.decisions', labelJa: 'Decision JSON', fieldKey: 'steps[].transition.decisions', summary: '条件付き遷移の decision 配列です。', effect: 'when.stateKey と equals / notEquals / in / exists / truthy のいずれか1つで分岐できます。', caution: 'backward goto では branching.loops[].id を loop に指定してください。' },
  'section.resultSinks': { id: 'section.resultSinks', labelJa: 'Result sinks', fieldKey: 'steps[].result.sinks', summary: 'result の出力先を定義します。', effect: '複数の sink を並べて、同じ result を複数の出力先へ渡せます。' },
  'result.sink.type': { id: 'result.sink.type', labelJa: 'Sink type', fieldKey: 'steps[].result.sinks[].type', summary: 'sink の種類です。', effect: 'file は path へ保存し、command は command / args 設定を使います。' },
  'result.sink.path': { id: 'result.sink.path', labelJa: 'File sink path', fieldKey: 'steps[].result.sinks[].path', summary: 'file sink の保存先パスです。', effect: 'workspace root 配下の成果物として result を保存します。' },
  'result.sink.encoding': { id: 'result.sink.encoding', labelJa: 'File encoding', fieldKey: 'steps[].result.sinks[].encoding', summary: 'file sink の文字エンコーディングです。', effect: '未指定なら writer 側の既定 encoding を使います。' },
  'result.sink.command': { id: 'result.sink.command', labelJa: 'Command sink name', fieldKey: 'steps[].result.sinks[].command', summary: 'command sink の識別名です。', effect: 'result text を別の sink 処理へ渡すときに使います。' },
  'result.sink.argsJson': { id: 'result.sink.argsJson', labelJa: 'Command sink args', fieldKey: 'steps[].result.sinks[].args', summary: 'command sink の追加引数です。GUI では JSON array として編集します。', effect: '固定値や template 値を sink 側へ渡せます。' }
});
`
}

export function renderWorkflowBuilderHelpTabSupplementScript(): string {
  return String.raw`
const workflowBuilderHelpTabForIdBase = helpTabForId;
helpTabForId = function(id) {
  if (!id) return undefined;
  if (id.indexOf('branching.') === 0 || id === 'section.branchCheckpoint') return 'branching';
  if (id.indexOf('manual.') === 0 || id.indexOf('transition.') === 0 || id.indexOf('result.sink.') === 0 || id === 'section.manualForm' || id === 'section.manualApproval' || id === 'section.transition' || id === 'section.resultSinks') return 'step';
  return workflowBuilderHelpTabForIdBase(id);
};
if (typeof decorateHelpTargets === 'function') decorateHelpTargets(document);
if (typeof renderHelpPanel === 'function') renderHelpPanel(activeHelpId || helpForActiveTab());
`
}
