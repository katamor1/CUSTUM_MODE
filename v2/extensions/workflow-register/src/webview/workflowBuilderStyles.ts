export function renderWorkflowBuilderStyles(): string {
  return String.raw`
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
header { padding: 14px 18px; border-bottom: 1px solid var(--vscode-panel-border); flex: 0 0 auto; }
main { display: grid; grid-template-columns: 340px minmax(420px, 1fr) minmax(280px, 360px); flex: 1 1 auto; min-height: 0; overflow: hidden; }
aside, section, .help-panel { min-height: 0; min-width: 0; overflow: auto; }
aside { border-right: 1px solid var(--vscode-panel-border); padding: 14px; }
section { padding: 14px 18px; }
h1 { font-size: 18px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 18px 0 8px; }
h3 { font-size: 13px; margin: 14px 0 6px; }
label { display: block; font-weight: 600; margin: 10px 0 4px; }
input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 6px; border-radius: 2px; font-family: var(--vscode-font-family); }
textarea { min-height: 92px; font-family: var(--vscode-editor-font-family); }
button { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 6px 10px; margin: 4px 4px 4px 0; border-radius: 2px; cursor: pointer; }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
button.link { background: transparent; color: var(--vscode-textLink-foreground); border: none; padding: 0; margin: 0; text-align: left; }
.muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { border: 1px solid var(--vscode-panel-border); padding: 10px; margin: 8px 0; border-radius: 4px; background: var(--vscode-sideBar-background); }
.step-card { cursor: pointer; }
.step-card.selected { outline: 1px solid var(--vscode-focusBorder); }
.badge { display: inline-block; border: 1px solid var(--vscode-panel-border); padding: 1px 6px; border-radius: 99px; font-size: 11px; margin-left: 6px; }
.badge.error { border-color: var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); }
.tabs { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid var(--vscode-panel-border); margin-top: 12px; }
.tab { padding: 6px 10px; cursor: pointer; border: 1px solid transparent; border-bottom: none; }
.tab.active { border-color: var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
pre { white-space: pre-wrap; overflow: auto; padding: 10px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); }
.diagnostics.ok, .reference-ok { border-left: 4px solid var(--vscode-testing-iconPassed); }
.diagnostics.ng, .reference-issue { border-left: 4px solid var(--vscode-testing-iconFailed); }
.issue-list { margin: 6px 0 0 18px; padding: 0; }
.issue-list li { margin: 4px 0; }
.help-inline-guide { border-left: 4px solid var(--vscode-focusBorder); }
.help-inline-guide ol { margin: 6px 0 0 20px; padding: 0; }
.help-panel { border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); padding: 14px; }
.help-panel h2 { margin-top: 0; }
.help-panel p { line-height: 1.55; }
.help-title { font-size: 14px; font-weight: 700; margin-top: 8px; }
.help-key, .field-key { display: inline-block; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 11px; font-weight: 400; margin-left: 4px; }
.help-button { width: 18px; height: 18px; min-width: 18px; padding: 0; margin-left: 4px; border-radius: 50%; font-size: 11px; line-height: 16px; vertical-align: middle; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.help-option { border: 1px solid var(--vscode-panel-border); border-left: 4px solid var(--vscode-focusBorder); padding: 8px; margin: 10px 0; background: var(--vscode-editor-background); }
.help-caution { color: var(--vscode-foreground); }
.help-search { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; margin-bottom: 12px; }
.help-search-results { display: grid; gap: 6px; margin-top: 8px; }
.help-result { display: block; width: 100%; text-align: left; background: var(--vscode-editor-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); }
.help-result span, .help-result em { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; font-style: normal; margin-top: 2px; }
`
}
