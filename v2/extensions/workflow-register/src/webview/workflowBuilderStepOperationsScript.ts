export function renderWorkflowBuilderStepOperationsScript(): string {
  return String.raw`
function makeStep(type) { const id = nextId(type === 'agent' ? 'analyze' : type === 'command' ? 'collect-context' : type === 'result' ? 'write-result' : 'confirm'); if (type === 'command') return { id: id, title: titleFromId(id), type: 'command', action: { provider: 'vscode.executeCommand', args: ['example.commandId'] }, resultKey: normalizeId(id) + 'Result' }; if (type === 'manual') return { id: id, title: titleFromId(id), type: 'manual', prompt: 'Confirm this step before continuing.' }; if (type === 'result') return { id: id, title: titleFromId(id), type: 'result', result: { source: 'state', stateKey: '', sinks: [{ type: 'file', path: '.bob/artifacts/' + id + '.md' }] } }; return { id: id, title: titleFromId(id), type: 'agent', prompt: 'Describe the task for Bob to perform.' }; }
function duplicate(value) { return JSON.parse(JSON.stringify(value)); }
function confirmReferenceChange(title, messages) { if (messages.length === 0) return true; return confirm(title + '\n\n' + messages.map(function(message) { return '- ' + message; }).join('\n')); }
function gotoHelpTarget(target) { if (target.dataset.index !== '') selectedStepIndex = Number(target.dataset.index); if (target.dataset.tab) activeTab = target.dataset.tab; render(); setTimeout(function() { if (window.workflowBuilderJumpToHelp) window.workflowBuilderJumpToHelp(target.dataset.helpId); }, 0); }
`
}
