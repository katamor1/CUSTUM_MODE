export function renderTemplateCustomizationStudioStyles(): string {
  return String.raw`
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
header { padding: 14px 18px; border-bottom: 1px solid var(--vscode-panel-border); flex: 0 0 auto; }
main { display: grid; grid-template-columns: minmax(300px, 360px) minmax(520px, 1fr); flex: 1 1 auto; min-height: 0; overflow: hidden; }
aside, section { min-height: 0; min-width: 0; overflow: auto; }
aside { border-right: 1px solid var(--vscode-panel-border); padding: 14px; background: var(--vscode-sideBar-background); }
section { padding: 14px 18px; }
h1 { font-size: 18px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 18px 0 8px; }
h3 { font-size: 13px; margin: 14px 0 6px; }
label { display: block; font-weight: 600; margin: 10px 0 4px; }
input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 6px; border-radius: 2px; font-family: var(--vscode-font-family); }
textarea { min-height: 96px; font-family: var(--vscode-editor-font-family); }
button { border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 6px 10px; margin: 4px 4px 4px 0; border-radius: 2px; cursor: pointer; }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
button:disabled { opacity: 0.55; cursor: not-allowed; }
pre { white-space: pre-wrap; overflow: auto; padding: 10px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); }
.muted { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; }
.tabs { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 12px; }
.tab { padding: 6px 10px; cursor: pointer; border: 1px solid transparent; border-bottom: none; }
.tab.active { border-color: var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.panel { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; margin: 8px 0; background: var(--vscode-editor-background); }
.template-list { display: grid; gap: 8px; margin-top: 8px; }
.template-item { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; background: var(--vscode-editor-background); cursor: pointer; }
.template-item.selected { outline: 1px solid var(--vscode-focusBorder); }
.template-title { font-weight: 700; }
.badge { display: inline-block; border: 1px solid var(--vscode-panel-border); padding: 1px 6px; border-radius: 99px; font-size: 11px; margin: 2px 4px 2px 0; }
.status.pass { border-left: 4px solid var(--vscode-testing-iconPassed); }
.status.warning { border-left: 4px solid var(--vscode-inputValidation-warningBorder); }
.status.fail, .status.error { border-left: 4px solid var(--vscode-testing-iconFailed); }
.input-defaults { display: grid; gap: 8px; }
.action-row { margin-top: 12px; }
`
}
