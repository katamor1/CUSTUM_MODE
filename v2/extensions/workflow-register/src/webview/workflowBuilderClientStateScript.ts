export function renderWorkflowBuilderClientStateScript(): string {
  return String.raw`
const vscode = acquireVsCodeApi();
let activeTab = 'step';
let selectedStepIndex = 0;
let previewTimer = undefined;
let latestPreview = '';
let latestDiagnostics = ['- preview is not ready yet.'];
let latestOk = false;
let latestFilePath = '';
let editorDiagnostics = [];
function escapeHtml(value) { return String(value === undefined || value === null ? '' : value).replace(/[&<>"]/g, function(ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]; }); }
function linesFromText(value) { return String(value || '').split(/\r?\n/).map(function(x) { return x.trim(); }).filter(Boolean); }
function textFromLines(value) { return Array.isArray(value) ? value.join('\n') : ''; }
function jsonForEditor(value) { if (value === undefined) return ''; try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); } }
function selectedStep() { return model.steps[selectedStepIndex]; }
function usedStepIds() { return model.steps.map(function(step) { return step.id; }); }
function usedBranchLoopIds() { ensureArrays(); return model.branching.loops.map(function(loop) { return loop.id; }); }
function normalizeId(value) { return String(value || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[._-]+/, '').replace(/[._-]+$/, ''); }
function nextId(base) { const normalized = normalizeId(base) || 'step'; const used = new Set(usedStepIds()); if (!used.has(normalized)) return normalized; for (let i = 2; i < 1000; i++) if (!used.has(normalized + '-' + i)) return normalized + '-' + i; return normalized + '-' + Date.now(); }
function nextBranchLoopId(base) { const normalized = normalizeId(base) || 'branch-loop'; const used = new Set(usedBranchLoopIds()); if (!used.has(normalized)) return normalized; for (let i = 2; i < 1000; i++) if (!used.has(normalized + '-' + i)) return normalized + '-' + i; return normalized + '-' + Date.now(); }
function titleFromId(id) { return String(id || 'New Step').split(/[._-]+/).filter(Boolean).map(function(part) { return part.slice(0, 1).toUpperCase() + part.slice(1); }).join(' ') || 'New Step'; }
function ensureArrays() { model.inputs = Array.isArray(model.inputs) ? model.inputs : []; model.preflight = Array.isArray(model.preflight) ? model.preflight : []; model.steps = Array.isArray(model.steps) ? model.steps : []; model.artifacts = Array.isArray(model.artifacts) ? model.artifacts : []; if (!model.guardrails) model.guardrails = {}; if (!Array.isArray(model.guardrails.requireApproval)) model.guardrails.requireApproval = []; if (!model.requires) model.requires = {}; if (!model.completion) model.completion = {}; if (!model.branching) model.branching = { enabled: false, loops: [] }; if (!Array.isArray(model.branching.loops)) model.branching.loops = []; }
function setEditorDiagnostic(key, message) { editorDiagnostics = editorDiagnostics.filter(function(item) { return item.key !== key; }); if (message) editorDiagnostics.push({ key: key, message: message }); if (activeTab === 'preview') renderPreview(); }
function clearEditorDiagnostic(key) { setEditorDiagnostic(key, undefined); }
function stepResultKeys(step) { const keys = []; if (step && step.resultKey) keys.push(step.resultKey); if (step && step.type === 'manual') { if (step.form && step.form.resultKey) keys.push(step.form.resultKey); if (step.approval && step.approval.resultKey) keys.push(step.approval.resultKey); } return keys; }
function resultKeysBefore(index, steps) { const target = steps || model.steps; return target.slice(0, Math.max(0, index)).flatMap(stepResultKeys).filter(Boolean); }
function allResultKeys(steps) { return new Set((steps || model.steps).flatMap(stepResultKeys).filter(Boolean)); }
function analyzeReferences(steps) { const targetSteps = steps || model.steps; const issues = []; const seenStepIds = new Set(); const seenResultKeys = new Set(); const resultKeys = allResultKeys(targetSteps); targetSteps.forEach(function(step, index) { if (seenStepIds.has(step.id)) issues.push({ stepId: step.id, stepIndex: index, helpId: 'step.id', tab: 'step', message: "Step '" + step.id + "' duplicates an earlier step id." }); seenStepIds.add(step.id); (Array.isArray(step.includeState) ? step.includeState : []).forEach(function(key) { if (!resultKeys.has(key)) issues.push({ stepId: step.id, stepIndex: index, key: key, helpId: 'step.includeState', tab: 'step', message: "Step '" + step.id + "' includeState references unknown resultKey '" + key + "'." }); else if (!seenResultKeys.has(key)) issues.push({ stepId: step.id, stepIndex: index, key: key, helpId: 'step.includeState', tab: 'step', message: "Step '" + step.id + "' includeState references resultKey '" + key + "' before it is produced." }); }); stepResultKeys(step).forEach(function(key) { seenResultKeys.add(key); }); }); const stepIds = new Set(targetSteps.map(function(step) { return step.id; })); model.artifacts.forEach(function(artifact, index) { if (artifact.producedBy && !stepIds.has(artifact.producedBy)) issues.push({ artifactId: artifact.id, artifactIndex: index, key: artifact.producedBy, helpId: 'artifact.producedBy', tab: 'artifacts', message: "Artifact '" + artifact.id + "' references unknown producedBy step '" + artifact.producedBy + "'." }); }); return issues; }
function issuesForStep(index) { const step = model.steps[index]; if (!step) return []; return analyzeReferences().filter(function(issue) { return issue.stepIndex === index || issue.stepId === step.id; }); }
function deletionImpact(index) { const step = model.steps[index]; if (!step) return []; const messages = []; stepResultKeys(step).forEach(function(resultKey) { messages.push('削除される resultKey: ' + resultKey); model.steps.forEach(function(candidate, candidateIndex) { if (candidateIndex !== index && (candidate.includeState || []).includes(resultKey)) messages.push("step '" + candidate.id + "' の includeState '" + resultKey + "' が参照切れになります。"); }); }); model.artifacts.forEach(function(artifact) { if (artifact.producedBy === step.id) messages.push("artifact '" + artifact.id + "' の producedBy が参照切れになります: " + artifact.path); }); return messages; }
function moveImpact(fromIndex, toIndex) { if (toIndex < 0 || toIndex >= model.steps.length || fromIndex === toIndex) return []; const next = model.steps.slice(); const moved = next.splice(fromIndex, 1)[0]; next.splice(toIndex, 0, moved); const movedKeys = new Set(stepResultKeys(moved)); return analyzeReferences(next).filter(function(issue) { return issue.stepId === moved.id || movedKeys.has(issue.key) || (moved.includeState || []).includes(issue.key); }).map(function(issue) { return issue.message; }); }
function requestPreview() { clearTimeout(previewTimer); previewTimer = setTimeout(function() { vscode.postMessage({ type: 'preview', model: model }); }, 180); }
`
}
