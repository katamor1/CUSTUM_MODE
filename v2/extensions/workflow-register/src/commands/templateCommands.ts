import * as fs from "fs/promises"
import * as path from "path"
import { load } from "js-yaml"
import { parseWorkflowMarkdown } from "../core/parser"
import { workspacePath } from "../process/processPaths"
import {
  generateCustomizedWorkflow,
  hashTemplateWorkflow
} from "../template/templateGenerator"
import {
  checkTemplateReadiness,
  renderReadinessMarkdown,
  type TemplateReadiness
} from "../template/templateReadiness"
import {
  validateProjectProfile,
  validateWorkflowCustomization,
  validateWorkflowTemplate
} from "../template/templateValidation"

const DEFAULT_TEMPLATE_PATH = ".bob/template-library/standard/process-code-precheck/metadata.yaml"

export interface TemplateCommandOptions {
  workspaceRoot: string
}

export interface TemplateCommandInput {
  templatePath?: string
  projectProfilePath?: string
  customizationPath?: string
}

export type TemplateCommandResult =
  | { status: "ok"; diagnostics: string[]; [key: string]: unknown }
  | { status: "error"; diagnostics: string[]; [key: string]: unknown }

interface TemplateBundle {
  templatePath: string
  template: unknown
  baseWorkflowPath: string
  baseWorkflowText: string
}

export async function validateLibraryCommand(
  input: TemplateCommandInput = {},
  options: TemplateCommandOptions
): Promise<TemplateCommandResult> {
  return runTemplateCommand(async () => {
    const bundle = await loadTemplateBundle(options.workspaceRoot, input.templatePath ?? DEFAULT_TEMPLATE_PATH)
    const validation = validateWorkflowTemplate(bundle.template)
    if (!validation.ok) return error(validation.diagnostics)
    const parsed = parseWorkflowMarkdown({
      sourceId: "workflow-register",
      filePath: bundle.baseWorkflowPath,
      text: bundle.baseWorkflowText
    })
    if (!parsed.ok) return error(parsed.diagnostics)
    return ok({
      template: validation.template,
      templatePath: bundle.templatePath,
      baseWorkflowPath: bundle.baseWorkflowPath,
      baseTemplateHash: hashTemplateWorkflow(bundle.baseWorkflowText)
    })
  })
}

export async function validateProjectProfileCommand(
  input: TemplateCommandInput = {},
  options: TemplateCommandOptions
): Promise<TemplateCommandResult> {
  return runTemplateCommand(async () => {
    const loaded = await readWorkspaceData(options.workspaceRoot, requiredPath(input.projectProfilePath, "projectProfilePath"))
    const validation = validateProjectProfile(loaded.data)
    if (!validation.ok) return error(validation.diagnostics)
    return ok({ profile: validation.profile, relativePath: loaded.relativePath })
  })
}

export async function validateCustomizationCommand(
  input: TemplateCommandInput = {},
  options: TemplateCommandOptions
): Promise<TemplateCommandResult> {
  return runTemplateCommand(async () => {
    const loaded = await readWorkspaceData(options.workspaceRoot, requiredPath(input.customizationPath, "customizationPath"))
    const validation = validateWorkflowCustomization(loaded.data)
    if (!validation.ok) return error(validation.diagnostics)
    return ok({ customization: validation.customization, relativePath: loaded.relativePath })
  })
}

export async function generateWorkflowCommand(
  input: TemplateCommandInput = {},
  options: TemplateCommandOptions
): Promise<TemplateCommandResult> {
  return runTemplateCommand(async () => {
    const generationInput = await loadGenerationInput(input, options)
    const generated = generateCustomizedWorkflow(generationInput)
    if (!generated.ok) return error(generated.diagnostics)
    const absolutePath = workspacePath(options.workspaceRoot, generated.relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, generated.workflowMarkdown, "utf8")
    return ok({
      workflowName: generated.workflowName,
      relativePath: generated.relativePath,
      absolutePath,
      baseTemplateHash: generated.baseTemplateHash
    })
  })
}

export async function checkReadinessCommand(
  input: TemplateCommandInput = {},
  options: TemplateCommandOptions
): Promise<TemplateCommandResult> {
  return runTemplateCommand(async () => {
    const generationInput = await loadGenerationInput(input, options)
    const readiness = await checkTemplateReadiness({
      workspaceRoot: options.workspaceRoot,
      ...generationInput
    })
    const { projectId, workflowName } = readinessOutputNames(generationInput.projectProfile, generationInput.customization)
    const outputRoot = `.bob/template-readiness/${projectId}`
    const jsonPath = `${outputRoot}/${workflowName}-readiness.json`
    const markdownPath = `${outputRoot}/${workflowName}-readiness.md`
    await writeReadinessReports(options.workspaceRoot, readiness, jsonPath, markdownPath)
    return ok({ readiness, readinessJsonPath: jsonPath, readinessMarkdownPath: markdownPath })
  })
}

async function loadGenerationInput(
  input: TemplateCommandInput,
  options: TemplateCommandOptions
): Promise<{
  template: unknown
  projectProfile: unknown
  customization: unknown
  baseWorkflowText: string
  customizationPath: string
}> {
  const bundle = await loadTemplateBundle(options.workspaceRoot, input.templatePath ?? DEFAULT_TEMPLATE_PATH)
  const projectProfile = await readWorkspaceData(options.workspaceRoot, requiredPath(input.projectProfilePath, "projectProfilePath"))
  const customization = await readWorkspaceData(options.workspaceRoot, requiredPath(input.customizationPath, "customizationPath"))
  return {
    template: bundle.template,
    projectProfile: projectProfile.data,
    customization: customization.data,
    baseWorkflowText: bundle.baseWorkflowText,
    customizationPath: customization.relativePath
  }
}

async function loadTemplateBundle(workspaceRoot: string, templatePath: string): Promise<TemplateBundle> {
  const loaded = await readWorkspaceData(workspaceRoot, templatePath)
  const metadata = loaded.data
  if (!isRecord(metadata) || typeof metadata.baseWorkflowPath !== "string") {
    return {
      templatePath: loaded.relativePath,
      template: metadata,
      baseWorkflowPath: "",
      baseWorkflowText: ""
    }
  }
  const baseWorkflowPath = metadata.baseWorkflowPath
  const baseWorkflowText = await readWorkspaceText(workspaceRoot, baseWorkflowPath)
  return { templatePath: loaded.relativePath, template: metadata, baseWorkflowPath, baseWorkflowText }
}

async function readWorkspaceData(workspaceRoot: string, relativePath: string): Promise<{ relativePath: string; data: unknown }> {
  const text = await readWorkspaceText(workspaceRoot, relativePath)
  return { relativePath: relativePath.replace(/\\/g, "/"), data: load(text) }
}

async function readWorkspaceText(workspaceRoot: string, relativePath: string): Promise<string> {
  return fs.readFile(workspacePath(workspaceRoot, relativePath), "utf8")
}

async function writeReadinessReports(
  workspaceRoot: string,
  readiness: TemplateReadiness,
  jsonPath: string,
  markdownPath: string
): Promise<void> {
  const jsonAbsolutePath = workspacePath(workspaceRoot, jsonPath)
  const markdownAbsolutePath = workspacePath(workspaceRoot, markdownPath)
  await fs.mkdir(path.dirname(jsonAbsolutePath), { recursive: true })
  await Promise.all([
    fs.writeFile(jsonAbsolutePath, `${JSON.stringify({ readiness }, null, 2)}\n`, "utf8"),
    fs.writeFile(markdownAbsolutePath, renderReadinessMarkdown(readiness), "utf8")
  ])
}

function readinessOutputNames(projectProfile: unknown, customization: unknown): { projectId: string; workflowName: string } {
  const profileId = isRecord(projectProfile) && typeof projectProfile.projectId === "string" ? projectProfile.projectId : "unknown-project"
  const workflowName = isRecord(customization) && typeof customization.workflowName === "string" ? customization.workflowName : "unknown-workflow"
  return { projectId: safeSegmentOrFallback(profileId, "unknown-project"), workflowName: safeSegmentOrFallback(workflowName, "unknown-workflow") }
}

async function runTemplateCommand(action: () => Promise<TemplateCommandResult>): Promise<TemplateCommandResult> {
  try {
    return await action()
  } catch (caught) {
    return error([caught instanceof Error ? caught.message : String(caught)])
  }
}

function requiredPath(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`)
  return value
}

function ok(extra: Record<string, unknown>): TemplateCommandResult {
  return { status: "ok", diagnostics: [], ...extra }
}

function error(diagnostics: string[]): TemplateCommandResult {
  return { status: "error", diagnostics, message: diagnostics.join("; ") }
}

function safeSegmentOrFallback(value: string, fallback: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..") ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
