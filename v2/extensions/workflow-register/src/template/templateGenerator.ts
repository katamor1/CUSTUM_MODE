import { createHash } from "crypto"
import { dump, load } from "js-yaml"
import {
  type ProjectProfile,
  type WorkflowCustomization,
  type WorkflowTemplate,
  validateProjectProfile,
  validateWorkflowCustomization,
  validateWorkflowTemplate
} from "./templateValidation"
import { describeUnsafeWorkspacePath } from "../process/processPaths"

const CODE_PRECHECK_ARTIFACT_ROOT = ".bob-process-runs/{{run.id}}/code-precheck"

export interface GenerateCustomizedWorkflowOptions {
  template: unknown
  projectProfile: unknown
  customization: unknown
  baseWorkflowText: string
  customizationPath: string
}

export type GenerateCustomizedWorkflowResult =
  | {
      ok: true
      diagnostics: string[]
      workflowMarkdown: string
      workflowName: string
      relativePath: string
      baseTemplateHash: string
    }
  | {
      ok: false
      diagnostics: string[]
      workflowMarkdown?: string
      workflowName?: string
      relativePath?: string
      baseTemplateHash?: string
    }

export function hashTemplateWorkflow(workflowText: string): string {
  return `sha256:${createHash("sha256").update(workflowText).digest("hex")}`
}

export function generateCustomizedWorkflow(options: GenerateCustomizedWorkflowOptions): GenerateCustomizedWorkflowResult {
  const diagnostics: string[] = []
  const templateValidation = validateWorkflowTemplate(options.template)
  const profileValidation = validateProjectProfile(options.projectProfile)
  const customizationValidation = validateWorkflowCustomization(options.customization)
  diagnostics.push(...templateValidation.diagnostics, ...profileValidation.diagnostics, ...customizationValidation.diagnostics)
  if (!templateValidation.ok || !profileValidation.ok || !customizationValidation.ok) {
    return { ok: false, diagnostics }
  }

  const template = templateValidation.template
  const projectProfile = profileValidation.profile
  const customization = customizationValidation.customization
  validateCompatibility(diagnostics, template, projectProfile, customization)
  const baseTemplateHash = hashTemplateWorkflow(options.baseWorkflowText)
  if (customization.baseTemplateHash !== baseTemplateHash) {
    diagnostics.push(`baseTemplateHash mismatch: expected ${baseTemplateHash}, received ${customization.baseTemplateHash}`)
  }

  const split = splitFrontMatter(options.baseWorkflowText)
  if (!split.ok) diagnostics.push(...split.diagnostics)
  if (diagnostics.length > 0 || !split.ok) {
    return {
      ok: false,
      diagnostics,
      workflowName: customization.workflowName,
      relativePath: `.bob/workflows/${customization.workflowName}/WORKFLOW.md`,
      baseTemplateHash
    }
  }

  const fields = cloneRecord(split.fields)
  applyWorkflowIdentity(fields, template, projectProfile, customization, options.customizationPath, baseTemplateHash)
  applyInputDefaults(diagnostics, fields, template, customization)
  applyChecklistPath(diagnostics, fields, template, customization, projectProfile)
  applyPromptSupplement(diagnostics, fields, template, customization)
  applyArtifactOutputRoot(diagnostics, fields, template, customization)
  applyHumanGate(diagnostics, fields, template, customization, projectProfile)
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics,
      workflowName: customization.workflowName,
      relativePath: `.bob/workflows/${customization.workflowName}/WORKFLOW.md`,
      baseTemplateHash
    }
  }

  const body = updateBodyHeading(split.body, firstString(customization.customize.title, fields.title, template.displayName))
  return {
    ok: true,
    diagnostics,
    workflowMarkdown: renderWorkflow(fields, body),
    workflowName: customization.workflowName,
    relativePath: `.bob/workflows/${customization.workflowName}/WORKFLOW.md`,
    baseTemplateHash
  }
}

function validateCompatibility(
  diagnostics: string[],
  template: WorkflowTemplate,
  projectProfile: ProjectProfile,
  customization: WorkflowCustomization
): void {
  if (customization.templateId !== template.templateId) {
    diagnostics.push(`customization.templateId must match templateId: ${template.templateId}`)
  }
  if (customization.templateVersion !== template.templateVersion) {
    diagnostics.push(`customization.templateVersion must match templateVersion: ${template.templateVersion}`)
  }
  if (customization.projectId !== projectProfile.projectId) {
    diagnostics.push(`customization.projectId must match project profile: ${projectProfile.projectId}`)
  }
  if (!template.supportedLanguages.includes(projectProfile.targetLanguage)) {
    diagnostics.push(`template ${template.templateId} does not support targetLanguage: ${projectProfile.targetLanguage}`)
  }
  if (!template.supportedVcs.includes(projectProfile.vcs.type)) {
    diagnostics.push(`template ${template.templateId} does not support vcs.type: ${projectProfile.vcs.type}`)
  }
}

function applyWorkflowIdentity(
  fields: Record<string, unknown>,
  template: WorkflowTemplate,
  projectProfile: ProjectProfile,
  customization: WorkflowCustomization,
  customizationPath: string,
  baseTemplateHash: string
): void {
  fields.name = customization.workflowName
  if (customization.customize.title !== undefined) fields.title = customization.customize.title
  if (customization.customize.description !== undefined) fields.description = customization.customize.description
  fields["x-bob-template"] = {
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    baseTemplateHash,
    projectId: projectProfile.projectId,
    customizationPath
  }
}

function applyInputDefaults(
  diagnostics: string[],
  fields: Record<string, unknown>,
  template: WorkflowTemplate,
  customization: WorkflowCustomization
): void {
  const defaults = customization.customize.inputs?.defaults
  if (!defaults) return
  if (!template.customizable.inputDefaults) {
    diagnostics.push("template does not allow input default customization")
    return
  }
  const inputs = ensureRecord(fields.inputs, "inputs", diagnostics)
  if (!inputs) return
  for (const [inputId, defaultValue] of Object.entries(defaults)) {
    if (!template.customizable.inputDefaults.includes(inputId)) {
      diagnostics.push(`customize.inputs.defaults.${inputId} is not allowed by template metadata`)
      continue
    }
    const input = ensureRecord(inputs[inputId], `inputs.${inputId}`, diagnostics)
    if (!input) continue
    validatePathLikeDefault(diagnostics, inputId, defaultValue)
    input.default = defaultValue
  }
}

function applyChecklistPath(
  diagnostics: string[],
  fields: Record<string, unknown>,
  template: WorkflowTemplate,
  customization: WorkflowCustomization,
  projectProfile: ProjectProfile
): void {
  const checklistPath = customization.customize.checklist?.path ?? projectProfile.paths.checklistPath
  if (!checklistPath) return
  const checklistInput = template.customizable.checklistPathInput
  if (!checklistInput) {
    diagnostics.push("template does not allow checklist path customization")
    return
  }
  const inputs = ensureRecord(fields.inputs, "inputs", diagnostics)
  const input = inputs ? ensureRecord(inputs[checklistInput], `inputs.${checklistInput}`, diagnostics) : undefined
  if (!input) return
  const previousPath = typeof input.default === "string" ? input.default : undefined
  input.default = checklistPath
  const requires = ensureRecord(fields.requires, "requires", diagnostics)
  if (!requires) return
  const files = Array.isArray(requires.files) ? [...requires.files] : []
  const nextFiles = files.map((file) => file === previousPath ? checklistPath : file)
  if (!nextFiles.includes(checklistPath)) nextFiles.push(checklistPath)
  requires.files = nextFiles
}

function applyPromptSupplement(
  diagnostics: string[],
  fields: Record<string, unknown>,
  template: WorkflowTemplate,
  customization: WorkflowCustomization
): void {
  const prompts = customization.customize.prompts
  if (!prompts || (!prompts.supplement && !prompts.terms)) return
  if (template.customizable.promptSupplement !== true) {
    diagnostics.push("template does not allow prompt supplement customization")
    return
  }
  if (!Array.isArray(fields.steps)) {
    diagnostics.push("steps must be an array before prompt customization")
    return
  }
  const supplement = renderPromptSupplement(prompts)
  for (const step of fields.steps) {
    if (!isRecord(step) || step.type !== "agent") continue
    const existingPrompt = typeof step.prompt === "string" ? step.prompt.trimEnd() : ""
    step.prompt = `${existingPrompt}\n\n${supplement}`.trim()
  }
}

function applyArtifactOutputRoot(
  diagnostics: string[],
  fields: Record<string, unknown>,
  template: WorkflowTemplate,
  customization: WorkflowCustomization
): void {
  const root = customization.customize.artifactOutputRoot
  if (!root) return
  if (template.customizable.artifactOutputRoot !== true) {
    diagnostics.push("template does not allow artifact output root customization")
    return
  }
  replaceStrings(fields, (value) => replaceArtifactPath(value, root))
}

function applyHumanGate(
  diagnostics: string[],
  fields: Record<string, unknown>,
  template: WorkflowTemplate,
  customization: WorkflowCustomization,
  projectProfile: ProjectProfile
): void {
  const humanGate = customization.customize.humanGate
  if (!humanGate && projectProfile.workflowPreferences.requireHumanGate !== true) return
  if (template.customizable.humanGate !== true) {
    diagnostics.push("template does not allow human gate customization")
    return
  }
  const stepReview = ensureRecord(fields.stepReview, "stepReview", diagnostics)
  if (!stepReview) return
  stepReview.enabled = true
  stepReview.requireAcceptBeforeNext = true
  stepReview.pauseAfter = humanGate?.stepReviewPauseAfter ?? projectProfile.workflowPreferences.stepReviewPauseAfter ?? stepReview.pauseAfter
}

function validatePathLikeDefault(diagnostics: string[], inputId: string, value: unknown): void {
  if (typeof value !== "string") return
  if (!/(Path|Root|Dir)$/u.test(inputId)) return
  const diagnostic = describeUnsafeWorkspacePath(`customize.inputs.defaults.${inputId}`, value)
  if (diagnostic) diagnostics.push(diagnostic)
}

function renderPromptSupplement(prompts: NonNullable<WorkflowCustomization["customize"]["prompts"]>): string {
  const lines = ["プロジェクト固有補足"]
  if (prompts.supplement) lines.push(prompts.supplement)
  if (prompts.terms && Object.keys(prompts.terms).length > 0) {
    lines.push("用語:")
    for (const [key, value] of Object.entries(prompts.terms)) {
      lines.push(`- ${key}: ${value}`)
    }
  }
  return lines.join("\n")
}

function replaceArtifactPath(value: string, root: string): string {
  if (!value.startsWith(CODE_PRECHECK_ARTIFACT_ROOT)) return value
  return `${root}${value.slice(CODE_PRECHECK_ARTIFACT_ROOT.length)}`
}

function replaceStrings(value: unknown, replacer: (value: string) => string): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (typeof value[index] === "string") {
        value[index] = replacer(value[index])
      } else {
        replaceStrings(value[index], replacer)
      }
    }
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      value[key] = replacer(child)
    } else {
      replaceStrings(child, replacer)
    }
  }
}

function splitFrontMatter(markdown: string):
  | { ok: true; fields: Record<string, unknown>; body: string }
  | { ok: false; diagnostics: string[] } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return { ok: false, diagnostics: ["base workflow must contain YAML front matter"] }
  }
  const fields = load(match[1])
  if (!isRecord(fields)) {
    return { ok: false, diagnostics: ["base workflow front matter must be an object"] }
  }
  return { ok: true, fields, body: match[2] }
}

function renderWorkflow(fields: Record<string, unknown>, body: string): string {
  const frontMatter = dump(fields, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd()
  return `---\n${frontMatter}\n---\n${body.replace(/^\s+/, "")}`
}

function updateBodyHeading(body: string, title: string): string {
  if (!body.trim()) return `# ${title}\n`
  return body.replace(/^# .*(\r?\n)/u, `# ${title}$1`)
}

function ensureRecord(value: unknown, label: string, diagnostics: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    diagnostics.push(`${label} must be an object`)
    return undefined
  }
  return value
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value
  }
  return "Workflow"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
