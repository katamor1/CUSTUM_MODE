import type {
  CFunctionDefinition,
  CProjectModel
} from "./cProjectModels";
import { cooperativeCheckpoint } from "./cooperativeAbort";

export interface CFunctionCaller {
  functionId: string;
  name: string;
  relativePath: string;
  display: string;
}

export interface CAmbiguousDirectCall {
  callee: string;
  caller: CFunctionCaller;
  candidateFunctionIds: string[];
  marker: "呼び出し先特定不可";
}

export interface CProjectIndex {
  functions: CFunctionDefinition[];
  callersByFunctionId: Record<string, CFunctionCaller[]>;
  ambiguousCalls: CAmbiguousDirectCall[];
}

export async function buildCProjectIndex(
  project: CProjectModel,
  signal?: AbortSignal
): Promise<CProjectIndex> {
  const functions = project.files.flatMap((file) => file.functions);
  const functionsByName = new Map<string, CFunctionDefinition[]>();
  const callersByFunctionId: Record<string, CFunctionCaller[]> = {};
  const callerAssignments = new Set<string>();
  const ambiguousAssignments = new Set<string>();
  const ambiguousCalls: CAmbiguousDirectCall[] = [];

  for (const [index, fn] of functions.entries()) {
    await cooperativeCheckpoint(signal, index, 32);
    const sameName = functionsByName.get(fn.name) ?? [];
    sameName.push(fn);
    functionsByName.set(fn.name, sameName);
    callersByFunctionId[fn.id] = [];
  }

  for (const [index, callerFunction] of functions.entries()) {
    await cooperativeCheckpoint(signal, index, 16);
    const caller = toFunctionCaller(callerFunction);
    const shadowedNames = new Set([
      ...callerFunction.localVariableNames,
      ...callerFunction.parameters.flatMap((parameter) => (
        parameter.name ? [parameter.name] : []
      ))
    ]);

    const references = [
      ...callerFunction.calls,
      ...callerFunction.functionPointerTableReferences
    ];
    for (const reference of references) {
      if (shadowedNames.has(reference.callee)) {
        continue;
      }
      const candidates = functionsByName.get(reference.callee) ?? [];
      const resolution = resolveTarget(callerFunction, candidates);
      if (resolution.kind === "resolved") {
        const assignmentKey = `${resolution.target.id}\0${caller.functionId}`;
        if (!callerAssignments.has(assignmentKey)) {
          callerAssignments.add(assignmentKey);
          callersByFunctionId[resolution.target.id].push(caller);
        }
      } else if (resolution.kind === "ambiguous") {
        const candidateFunctionIds = resolution.candidates
          .map((candidate) => candidate.id)
          .sort();
        const assignmentKey = `${caller.functionId}\0${reference.callee}\0${candidateFunctionIds.join("\0")}`;
        if (!ambiguousAssignments.has(assignmentKey)) {
          ambiguousAssignments.add(assignmentKey);
          ambiguousCalls.push({
            callee: reference.callee,
            caller,
            candidateFunctionIds,
            marker: "呼び出し先特定不可"
          });
        }
      }
    }
  }

  for (const callers of Object.values(callersByFunctionId)) {
    callers.sort(compareCallers);
  }
  signal?.throwIfAborted();
  ambiguousCalls.sort((left, right) => (
    compareCallers(left.caller, right.caller)
    || left.callee.localeCompare(right.callee)
  ));

  return { functions, callersByFunctionId, ambiguousCalls };
}

export function getDirectCallers(
  index: CProjectIndex,
  target: CFunctionDefinition | string
): CFunctionCaller[] {
  const functionId = typeof target === "string" ? target : target.id;
  return [...(index.callersByFunctionId[functionId] ?? [])];
}

function resolveTarget(
  caller: CFunctionDefinition,
  candidates: CFunctionDefinition[]
):
  | { kind: "resolved"; target: CFunctionDefinition }
  | { kind: "ambiguous"; candidates: CFunctionDefinition[] }
  | { kind: "unresolved" } {
  const localStaticCandidates = candidates.filter((candidate) => (
    candidate.relativePath === caller.relativePath
    && candidate.storageClasses.includes("static")
  ));
  if (localStaticCandidates.length === 1) {
    return { kind: "resolved", target: localStaticCandidates[0] };
  }
  if (localStaticCandidates.length > 1) {
    return { kind: "ambiguous", candidates: localStaticCandidates };
  }

  const globalCandidates = candidates.filter(
    (candidate) => !candidate.storageClasses.includes("static")
  );
  if (globalCandidates.length === 1) {
    return { kind: "resolved", target: globalCandidates[0] };
  }
  if (globalCandidates.length > 1) {
    return { kind: "ambiguous", candidates: globalCandidates };
  }
  return { kind: "unresolved" };
}

function toFunctionCaller(fn: CFunctionDefinition): CFunctionCaller {
  return {
    functionId: fn.id,
    name: fn.name,
    relativePath: fn.relativePath,
    display: `${fn.relativePath} : ${fn.name}`
  };
}

function compareCallers(left: CFunctionCaller, right: CFunctionCaller): number {
  return left.relativePath.localeCompare(right.relativePath)
    || left.name.localeCompare(right.name)
    || left.functionId.localeCompare(right.functionId);
}
