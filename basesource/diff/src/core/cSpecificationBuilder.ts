import {
  associateDoxygenComments,
  type DoxygenDocumentation,
  type DoxygenParameterDirection
} from "./doxygenParser";
import {
  buildCProjectIndex,
  getDirectCallers,
  type CFunctionCaller
} from "./cProjectIndex";
import type {
  CFunctionParameter,
  CGlobalVariableDeclaration,
  CProjectModel,
  CRecordDefinition,
  CRecordMember,
  CTypeReference
} from "./cProjectModels";
import type {
  CRecordSpecificationCandidate,
  CSpecificationDiff
} from "./cSpecificationDiff";
import {
  createCTypeLayoutResolver,
  type CLayoutValue,
  type CTypeLayoutResolver
} from "./cTypeLayout";
import { cooperativeCheckpoint } from "./cooperativeAbort";

const MISSING = "記載なし" as const;
const AMBIGUOUS_CALL = "呼び出し先特定不可" as const;

export interface FunctionParameterSpecification {
  name: string;
  declaration: string;
  typeName: string;
  direction: DoxygenParameterDirection | typeof MISSING;
  description: string;
}

export interface DescriptionEntry {
  value: string;
  description: string;
}

export interface NewFunctionSpecification {
  name: string;
  relativePath: string;
  declaration: string;
  returnType: string;
  parameters: FunctionParameterSpecification[];
  brief: string;
  details: string;
  returnDescription: string;
  returnValues: DescriptionEntry[];
  notes: string[];
  warnings: string[];
  callers: Array<CFunctionCaller | typeof AMBIGUOUS_CALL>;
}

export interface NewGlobalVariableSpecification {
  name: string;
  relativePath: string;
  declaration: string;
  description: string;
  typeName: string;
  arrayDimensions: CLayoutValue[];
  elementCount: CLayoutValue;
  sizeBytes: CLayoutValue;
}

export interface RecordMemberSpecification {
  name: string;
  declaration: string;
  typeName: string;
  arrayDimensions: CLayoutValue[];
  elementCount: CLayoutValue;
  sizeBytes: CLayoutValue;
  description: string;
}

export interface NewRecordSpecification {
  kind: "struct" | "union";
  name: string;
  relativePath: string;
  description: string;
  status: "new-type" | "existing-type-new-members";
  members: RecordMemberSpecification[];
  sizeBytes: CLayoutValue;
  declaredVariables: NewGlobalVariableSpecification[];
}

export interface CSpecificationModels {
  functions: NewFunctionSpecification[];
  globalVariables: NewGlobalVariableSpecification[];
  records: NewRecordSpecification[];
}

export interface BuildCSpecificationsInput {
  project: CProjectModel;
  diff: CSpecificationDiff;
  sources?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export async function buildCSpecifications(
  input: BuildCSpecificationsInput
): Promise<CSpecificationModels> {
  const projectIndex = await buildCProjectIndex(input.project, input.signal);
  await cooperativeCheckpoint(input.signal);
  const layoutResolver = createCTypeLayoutResolver(input.project);
  const sourceByPath = normalizeSources(input.sources);
  const fileByPath = new Map(input.project.files.map((file) => [file.relativePath, file]));
  const variableSpecifications = new Map<CGlobalVariableDeclaration, NewGlobalVariableSpecification>();

  const globalVariables: NewGlobalVariableSpecification[] = [];
  for (const [index, variable] of input.diff.newGlobalVariables.entries()) {
    await cooperativeCheckpoint(input.signal, index, 16);
    const specification = buildGlobalVariableSpecification(
      variable,
      fileByPath,
      sourceByPath,
      layoutResolver
    );
    variableSpecifications.set(variable, specification);
    globalVariables.push(specification);
  }

  const functions: NewFunctionSpecification[] = [];
  for (const [index, fn] of input.diff.newFunctions.entries()) {
    await cooperativeCheckpoint(input.signal, index, 16);
    const file = fileByPath.get(fn.relativePath);
    const source = sourceByPath.get(fn.relativePath) ?? "";
    const documentation = file
      ? associateDoxygenComments(
        source,
        file.comments,
        fn.range,
        { parameterNames: fn.parameters.flatMap((parameter) => parameter.name ? [parameter.name] : []) }
      ).documentation
      : undefined;
    const callers: Array<CFunctionCaller | typeof AMBIGUOUS_CALL> = getDirectCallers(
      projectIndex,
      fn
    );
    if (projectIndex.ambiguousCalls.some((call) => call.candidateFunctionIds.includes(fn.id))) {
      callers.push(AMBIGUOUS_CALL);
    }
    functions.push({
      name: fn.name,
      relativePath: fn.relativePath,
      declaration: fn.declaration,
      returnType: displayType(fn.returnType),
      parameters: fn.parameters.map((parameter) => buildParameter(parameter, documentation)),
      brief: documentation?.brief ?? MISSING,
      details: documentation?.details ?? MISSING,
      returnDescription: documentation?.returnDescription ?? MISSING,
      returnValues: documentation?.returnValues.map((entry) => ({
        value: entry.value,
        description: entry.description || MISSING
      })) ?? [],
      notes: documentation?.notes.length ? documentation.notes : [MISSING],
      warnings: documentation?.warnings.length ? documentation.warnings : [MISSING],
      callers
    });
  }

  const records: NewRecordSpecification[] = [];
  for (const [index, candidate] of input.diff.records.entries()) {
    await cooperativeCheckpoint(input.signal, index, 16);
    records.push(buildRecordSpecification(
      candidate,
      input.diff.newGlobalVariables,
      variableSpecifications,
      fileByPath,
      sourceByPath,
      layoutResolver
    ));
  }

  input.signal?.throwIfAborted();
  return { functions, globalVariables, records };
}

function buildParameter(
  parameter: CFunctionParameter,
  documentation?: DoxygenDocumentation
): FunctionParameterSpecification {
  const name = parameter.name ?? "匿名";
  const parameterDocumentation = documentation?.parameters.find((entry) => entry.name === name);
  return {
    name,
    declaration: parameter.declaration,
    typeName: displayType(parameter.type),
    direction: parameterDocumentation?.direction ?? MISSING,
    description: parameterDocumentation?.description || MISSING
  };
}

function buildGlobalVariableSpecification(
  variable: CGlobalVariableDeclaration,
  fileByPath: Map<string, CProjectModel["files"][number]>,
  sourceByPath: Map<string, string>,
  layoutResolver: CTypeLayoutResolver
): NewGlobalVariableSpecification {
  const file = fileByPath.get(variable.relativePath);
  const source = sourceByPath.get(variable.relativePath) ?? "";
  const association = file
    ? associateDoxygenComments(source, file.comments, variable.declarationRange)
    : undefined;
  const layout = layoutResolver.layoutVariable(variable);
  return {
    name: variable.name,
    relativePath: variable.relativePath,
    declaration: variable.declaration,
    description: association?.trailingDescription
      ?? association?.documentation?.details
      ?? association?.documentation?.brief
      ?? MISSING,
    typeName: displayType(variable.type),
    arrayDimensions: layout.arrayDimensions,
    elementCount: layout.elementCount,
    sizeBytes: layout.sizeBytes
  };
}

function buildRecordSpecification(
  candidate: CRecordSpecificationCandidate,
  newVariables: CGlobalVariableDeclaration[],
  variableSpecifications: Map<CGlobalVariableDeclaration, NewGlobalVariableSpecification>,
  fileByPath: Map<string, CProjectModel["files"][number]>,
  sourceByPath: Map<string, string>,
  layoutResolver: CTypeLayoutResolver
): NewRecordSpecification {
  const record = candidate.record;
  const file = fileByPath.get(record.relativePath);
  const source = sourceByPath.get(record.relativePath) ?? "";
  const association = file
    ? associateDoxygenComments(source, file.comments, record.range)
    : undefined;
  const declaredVariables = newVariables
    .filter((variable) => declarationContainsRecord(variable, record))
    .map((variable) => variableSpecifications.get(variable))
    .filter((value): value is NewGlobalVariableSpecification => Boolean(value));

  return {
    kind: record.kind,
    name: record.name ?? "匿名",
    relativePath: record.relativePath,
    description: association?.documentation?.details
      ?? association?.documentation?.brief
      ?? MISSING,
    status: candidate.status,
    members: candidate.members.map((member) => buildRecordMemberSpecification(
      member,
      record,
      fileByPath,
      sourceByPath,
      layoutResolver
    )),
    sizeBytes: layoutResolver.layoutRecord(record).sizeBytes,
    declaredVariables
  };
}

function buildRecordMemberSpecification(
  member: CRecordMember,
  record: CRecordDefinition,
  fileByPath: Map<string, CProjectModel["files"][number]>,
  sourceByPath: Map<string, string>,
  layoutResolver: CTypeLayoutResolver
): RecordMemberSpecification {
  const file = fileByPath.get(record.relativePath);
  const source = sourceByPath.get(record.relativePath) ?? "";
  const association = file
    ? associateDoxygenComments(source, file.comments, member.declarationRange)
    : undefined;
  const layout = layoutResolver.layoutMember(member, record);
  return {
    name: member.name ?? "匿名",
    declaration: member.declaration,
    typeName: displayType(member.type),
    arrayDimensions: layout.arrayDimensions,
    elementCount: layout.elementCount,
    sizeBytes: layout.sizeBytes,
    description: association?.trailingDescription
      ?? association?.documentation?.details
      ?? association?.documentation?.brief
      ?? MISSING
  };
}

function declarationContainsRecord(
  variable: CGlobalVariableDeclaration,
  record: CRecordDefinition
): boolean {
  return variable.relativePath === record.relativePath
    && variable.declarationRange.startIndex <= record.range.startIndex
    && variable.declarationRange.endIndex >= record.range.endIndex;
}

function displayType(type: CTypeReference): string {
  return type.raw || type.baseType || MISSING;
}

function normalizeSources(
  sources: BuildCSpecificationsInput["sources"]
): Map<string, string> {
  const entries = sources instanceof Map
    ? [...sources.entries()]
    : Object.entries(sources ?? {});
  return new Map(entries.map(([relativePath, source]) => [
    normalizeProjectPath(relativePath),
    source
  ]));
}

function normalizeProjectPath(relativePath: string): string {
  const normalized = relativePath
    .replaceAll("\\", "/")
    .replace(/^\$\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  return `$/${normalized}`;
}
