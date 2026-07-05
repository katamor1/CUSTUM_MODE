import {
  PROCESS_TARGET_LANGUAGES,
  PROCESS_VCS_TYPES,
  type ProcessTargetLanguage,
  type ProcessVcsType
} from "../process/processTypes"
import { describeUnsafeWorkspacePath, validateSafePathSegment } from "../process/processPaths"

export const TEMPLATE_SCHEMA_VERSION = "bob-workflow-template/v1" as const
export const PROJECT_PROFILE_SCHEMA_VERSION = "bob-project-profile/v1" as const
export const CUSTOMIZATION_SCHEMA_VERSION = "bob-workflow-customization/v1" as const

const STEP_REVIEW_PAUSE_AFTER = ["everyStep", "agentAndCommand", "none"] as const
const CUSTOMIZABLE_FIELDS = new Set([
  "title",
  "description",
  "inputs",
  "checklist",
  "prompts",
  "artifactOutputRoot",
  "humanGate"
])

export interface WorkflowTemplateCustomizationPolicy {
  title?: boolean
  description?: boolean
  inputDefaults?: string[]
  checklistPathInput?: string
  promptSupplement?: boolean
  artifactOutputRoot?: boolean
  humanGate?: boolean
}

export interface WorkflowTemplateLockedPolicy {
  guardrails: true
  commandProviders: true
  resultSinkTypes: true
}

export interface WorkflowTemplate {
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION
  templateId: string
  templateVersion: string
  displayName: string
  description: string
  baseWorkflowPath: string
  supportedLanguages: string[]
  supportedVcs: string[]
  requiredFiles?: string[]
  customizable: WorkflowTemplateCustomizationPolicy
  locked: WorkflowTemplateLockedPolicy
}

export interface ProjectProfile {
  schemaVersion: typeof PROJECT_PROFILE_SCHEMA_VERSION
  projectId: string
  displayName?: string
  targetLanguage: string
  vcs: {
    type: string
    root: string
    noAliases?: boolean
    revision?: string
    branch?: string
  }
  paths: {
    checklistPath: string
    artifactOutputRoot: string
    uatEvidencePath?: string
  }
  workflowPreferences: {
    requireHumanGate: true
    stepReviewPauseAfter?: string
  }
}

export interface WorkflowCustomization {
  schemaVersion: typeof CUSTOMIZATION_SCHEMA_VERSION
  customizationId: string
  templateId: string
  templateVersion: string
  baseTemplateHash: string
  projectId: string
  workflowName: string
  customize: {
    title?: string
    description?: string
    inputs?: { defaults?: Record<string, unknown> }
    checklist?: { path?: string }
    prompts?: { supplement?: string; terms?: Record<string, string> }
    artifactOutputRoot?: string
    humanGate?: { required?: boolean; stepReviewPauseAfter?: string }
  }
}

export type TemplateValidationResult<T, K extends string> =
  | ({ ok: true; diagnostics: string[] } & Record<K, T>)
  | ({ ok: false; diagnostics: string[] } & Partial<Record<K, T>>)

export function validateWorkflowTemplate(candidate: unknown): TemplateValidationResult<WorkflowTemplate, "template"> {
  const diagnostics: string[] = []
  if (!isRecord(candidate)) {
    return { ok: false, diagnostics: ["workflow template must be an object"] }
  }
  expectExactString(diagnostics, candidate, "schemaVersion", TEMPLATE_SCHEMA_VERSION)
  expectSafeSegment(diagnostics, candidate.templateId, "templateId")
  expectNonEmptyString(diagnostics, candidate, "templateVersion")
  expectNonEmptyString(diagnostics, candidate, "displayName")
  expectNonEmptyString(diagnostics, candidate, "description")
  expectWorkspacePath(diagnostics, candidate.baseWorkflowPath, "baseWorkflowPath")
  expectSupportedStringArray(diagnostics, candidate.supportedLanguages, "supportedLanguages", PROCESS_TARGET_LANGUAGES, "targetLanguage")
  expectSupportedStringArray(diagnostics, candidate.supportedVcs, "supportedVcs", PROCESS_VCS_TYPES, "vcs.type")
  validateRequiredFiles(diagnostics, candidate.requiredFiles)
  validateCustomizablePolicy(diagnostics, candidate.customizable)
  validateLockedPolicy(diagnostics, candidate.locked)
  return finishValidation(diagnostics, candidate as unknown as WorkflowTemplate, "template")
}

export function validateProjectProfile(candidate: unknown): TemplateValidationResult<ProjectProfile, "profile"> {
  const diagnostics: string[] = []
  if (!isRecord(candidate)) {
    return { ok: false, diagnostics: ["project profile must be an object"] }
  }
  expectExactString(diagnostics, candidate, "schemaVersion", PROJECT_PROFILE_SCHEMA_VERSION)
  expectSafeSegment(diagnostics, candidate.projectId, "projectId")
  if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") {
    diagnostics.push("displayName must be a string when present")
  }
  const targetLanguage = expectNonEmptyString(diagnostics, candidate, "targetLanguage")
  if (targetLanguage && !PROCESS_TARGET_LANGUAGES.includes(targetLanguage as ProcessTargetLanguage)) {
    diagnostics.push(`targetLanguage is not supported: ${targetLanguage}`)
  }
  validateProjectVcs(diagnostics, candidate.vcs)
  validateProjectPaths(diagnostics, candidate.paths)
  validateWorkflowPreferences(diagnostics, candidate.workflowPreferences)
  return finishValidation(diagnostics, candidate as unknown as ProjectProfile, "profile")
}

export function validateWorkflowCustomization(candidate: unknown): TemplateValidationResult<WorkflowCustomization, "customization"> {
  const diagnostics: string[] = []
  if (!isRecord(candidate)) {
    return { ok: false, diagnostics: ["workflow customization must be an object"] }
  }
  expectExactString(diagnostics, candidate, "schemaVersion", CUSTOMIZATION_SCHEMA_VERSION)
  expectSafeSegment(diagnostics, candidate.customizationId, "customizationId")
  expectSafeSegment(diagnostics, candidate.templateId, "templateId")
  expectNonEmptyString(diagnostics, candidate, "templateVersion")
  expectNonEmptyString(diagnostics, candidate, "baseTemplateHash")
  expectSafeSegment(diagnostics, candidate.projectId, "projectId")
  expectSafeSegment(diagnostics, candidate.workflowName, "workflowName")
  validateCustomizeBlock(diagnostics, candidate.customize)
  return finishValidation(diagnostics, candidate as unknown as WorkflowCustomization, "customization")
}

function validateRequiredFiles(diagnostics: string[], value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    diagnostics.push("requiredFiles must be an array when present")
    return
  }
  for (let index = 0; index < value.length; index += 1) {
    expectWorkspacePath(diagnostics, value[index], `requiredFiles[${index}]`)
  }
}

function validateCustomizablePolicy(diagnostics: string[], value: unknown): void {
  if (!isRecord(value)) {
    diagnostics.push("customizable must be an object")
    return
  }
  for (const key of ["title", "description", "promptSupplement", "artifactOutputRoot", "humanGate"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      diagnostics.push(`customizable.${key} must be a boolean when present`)
    }
  }
  if (value.inputDefaults !== undefined) {
    expectStringArray(diagnostics, value.inputDefaults, "customizable.inputDefaults")
  }
  if (value.checklistPathInput !== undefined) {
    expectSafeSegment(diagnostics, value.checklistPathInput, "customizable.checklistPathInput")
  }
}

function validateLockedPolicy(diagnostics: string[], value: unknown): void {
  if (!isRecord(value)) {
    diagnostics.push("locked must be an object")
    return
  }
  for (const key of ["guardrails", "commandProviders", "resultSinkTypes"]) {
    if (value[key] !== true) {
      diagnostics.push(`locked.${key} must be true`)
    }
  }
}

function validateProjectVcs(diagnostics: string[], value: unknown): void {
  if (!isRecord(value)) {
    diagnostics.push("vcs must be an object")
    return
  }
  const type = expectNonEmptyString(diagnostics, value, "type", "vcs")
  if (type && !PROCESS_VCS_TYPES.includes(type as ProcessVcsType)) {
    diagnostics.push(`vcs.type is not supported: ${type}`)
  }
  expectWorkspacePath(diagnostics, value.root, "vcs.root")
  if ((type === "bazaar" || type === "bzr") && value.noAliases !== true) {
    diagnostics.push("Bazaar project profile must assert bzr --no-aliases usage with vcs.noAliases: true")
  }
  if (value.noAliases !== undefined && typeof value.noAliases !== "boolean") {
    diagnostics.push("vcs.noAliases must be a boolean when present")
  }
  if (value.revision !== undefined && typeof value.revision !== "string") {
    diagnostics.push("vcs.revision must be a string when present")
  }
  if (value.branch !== undefined && typeof value.branch !== "string") {
    diagnostics.push("vcs.branch must be a string when present")
  }
}

function validateProjectPaths(diagnostics: string[], value: unknown): void {
  if (!isRecord(value)) {
    diagnostics.push("paths must be an object")
    return
  }
  expectWorkspacePath(diagnostics, value.checklistPath, "paths.checklistPath")
  expectWorkspacePath(diagnostics, value.artifactOutputRoot, "paths.artifactOutputRoot")
  if (value.uatEvidencePath !== undefined) {
    expectWorkspacePath(diagnostics, value.uatEvidencePath, "paths.uatEvidencePath")
  }
}

function validateWorkflowPreferences(diagnostics: string[], value: unknown): void {
  if (!isRecord(value)) {
    diagnostics.push("workflowPreferences must be an object")
    return
  }
  if (value.requireHumanGate !== true) {
    diagnostics.push("human gate must be explicitly required")
  }
  if (value.stepReviewPauseAfter !== undefined && !STEP_REVIEW_PAUSE_AFTER.includes(value.stepReviewPauseAfter as typeof STEP_REVIEW_PAUSE_AFTER[number])) {
    diagnostics.push(`workflowPreferences.stepReviewPauseAfter is not supported: ${value.stepReviewPauseAfter}`)
  }
}

function validateCustomizeBlock(diagnostics: string[], value: unknown): void {
  if (!isRecord(value)) {
    diagnostics.push("customize must be an object")
    return
  }
  for (const key of Object.keys(value)) {
    if (!CUSTOMIZABLE_FIELDS.has(key)) {
      diagnostics.push(`customize.${key} is not customizable`)
    }
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    diagnostics.push("customize.title must be a string when present")
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    diagnostics.push("customize.description must be a string when present")
  }
  validateInputCustomization(diagnostics, value.inputs)
  validateChecklistCustomization(diagnostics, value.checklist)
  validatePromptCustomization(diagnostics, value.prompts)
  if (value.artifactOutputRoot !== undefined) {
    expectWorkspacePath(diagnostics, value.artifactOutputRoot, "customize.artifactOutputRoot")
  }
  validateHumanGateCustomization(diagnostics, value.humanGate)
}

function validateInputCustomization(diagnostics: string[], value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    diagnostics.push("customize.inputs must be an object")
    return
  }
  if (value.defaults === undefined) return
  if (!isRecord(value.defaults)) {
    diagnostics.push("customize.inputs.defaults must be an object")
    return
  }
  for (const [key, defaultValue] of Object.entries(value.defaults)) {
    expectSafeSegment(diagnostics, key, `customize.inputs.defaults.${key}`)
    if (!["string", "number", "boolean"].includes(typeof defaultValue) && defaultValue !== null) {
      diagnostics.push(`customize.inputs.defaults.${key} default must be string, number, boolean, or null`)
    }
  }
}

function validateChecklistCustomization(diagnostics: string[], value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    diagnostics.push("customize.checklist must be an object")
    return
  }
  if (value.path !== undefined) {
    expectWorkspacePath(diagnostics, value.path, "customize.checklist.path")
  }
}

function validatePromptCustomization(diagnostics: string[], value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    diagnostics.push("customize.prompts must be an object")
    return
  }
  if (value.supplement !== undefined && typeof value.supplement !== "string") {
    diagnostics.push("customize.prompts.supplement must be a string when present")
  }
  if (value.terms !== undefined) {
    if (!isRecord(value.terms)) {
      diagnostics.push("customize.prompts.terms must be an object when present")
    } else {
      for (const [key, term] of Object.entries(value.terms)) {
        expectSafeSegment(diagnostics, key, `customize.prompts.terms.${key}`)
        if (typeof term !== "string") {
          diagnostics.push(`customize.prompts.terms.${key} must be a string`)
        }
      }
    }
  }
}

function validateHumanGateCustomization(diagnostics: string[], value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    diagnostics.push("customize.humanGate must be an object")
    return
  }
  if (value.required !== true) {
    diagnostics.push("customize.humanGate.required must be true")
  }
  if (value.stepReviewPauseAfter !== undefined && !STEP_REVIEW_PAUSE_AFTER.includes(value.stepReviewPauseAfter as typeof STEP_REVIEW_PAUSE_AFTER[number])) {
    diagnostics.push(`customize.humanGate.stepReviewPauseAfter is not supported: ${value.stepReviewPauseAfter}`)
  }
}

function expectWorkspacePath(diagnostics: string[], value: unknown, label: string): void {
  const diagnostic = describeUnsafeWorkspacePath(label, value)
  if (diagnostic) diagnostics.push(diagnostic)
}

function expectExactString(
  diagnostics: string[],
  candidate: Record<string, unknown>,
  key: string,
  expected: string
): string | undefined {
  const value = candidate[key]
  if (value !== expected) {
    diagnostics.push(`${key} must be ${expected}`)
    return undefined
  }
  return value
}

function expectNonEmptyString(
  diagnostics: string[],
  candidate: Record<string, unknown>,
  key: string,
  prefix?: string
): string | undefined {
  const label = prefix ? `${prefix}.${key}` : key
  const value = candidate[key]
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(`${label} must be a non-empty string`)
    return undefined
  }
  return value
}

function expectSafeSegment(diagnostics: string[], value: unknown, label: string): void {
  const diagnostic = validateSafePathSegment(value, label)
  if (diagnostic) diagnostics.push(diagnostic)
}

function expectStringArray(diagnostics: string[], value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    diagnostics.push(`${label} must be an array`)
    return []
  }
  const strings: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (typeof item !== "string" || item.trim().length === 0) {
      diagnostics.push(`${label}[${index}] must be a non-empty string`)
      continue
    }
    strings.push(item)
  }
  return strings
}

function expectSupportedStringArray(
  diagnostics: string[],
  value: unknown,
  label: string,
  supportedValues: readonly string[],
  valueLabel: string
): void {
  const values = expectStringArray(diagnostics, value, label)
  for (const item of values) {
    if (!supportedValues.includes(item)) {
      diagnostics.push(`${label} includes unsupported ${valueLabel}: ${item}`)
    }
  }
}

function finishValidation<T, K extends string>(
  diagnostics: string[],
  value: T,
  key: K
): TemplateValidationResult<T, K> {
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics, [key]: value } as TemplateValidationResult<T, K>
  }
  return { ok: true, diagnostics, [key]: value } as TemplateValidationResult<T, K>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
