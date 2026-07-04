import { buildCSpecifications, type CSpecificationModels } from "./cSpecificationBuilder";
import { diffCSpecifications } from "./cSpecificationDiff";
import { parseCProject } from "./cProjectParser";
import { collectCSourceInputs } from "./cProjectSources";
import type { CProjectModel } from "./cProjectModels";
import { cooperativeCheckpoint } from "./cooperativeAbort";

export interface BuildProjectCSpecificationsInput {
  beforeRoot: string;
  afterRoot: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number, relativePath: string) => void;
  onResolvingTypes?: () => void;
}

export async function buildProjectCSpecifications(
  input: BuildProjectCSpecificationsInput
): Promise<CSpecificationModels> {
  input.signal?.throwIfAborted();
  const [beforeSources, afterSources] = await Promise.all([
    collectCSourceInputs(input.beforeRoot, input.signal),
    collectCSourceInputs(input.afterRoot, input.signal)
  ]);
  const total = beforeSources.length + afterSources.length;
  let completed = 0;

  const before = await parseWithProgress(
    beforeSources,
    (relativePath) => {
      completed += 1;
      input.onProgress?.(completed, total, relativePath);
    },
    input.signal
  );
  const after = await parseWithProgress(
    afterSources,
    (relativePath) => {
      completed += 1;
      input.onProgress?.(completed, total, relativePath);
    },
    input.signal
  );

  input.signal?.throwIfAborted();
  input.onResolvingTypes?.();
  await cooperativeCheckpoint(input.signal);
  return buildCSpecifications({
    project: after,
    diff: diffCSpecifications(before, after),
    sources: new Map(afterSources.map((source) => [source.relativePath, source.content])),
    signal: input.signal
  });
}

async function parseWithProgress(
  sources: Awaited<ReturnType<typeof collectCSourceInputs>>,
  onParsed: (relativePath: string) => void,
  signal?: AbortSignal
): Promise<CProjectModel> {
  const files = [];
  for (const source of sources) {
    signal?.throwIfAborted();
    const parsed = await parseCProject([source]);
    files.push(...parsed.files);
    onParsed(source.relativePath);
    await cooperativeCheckpoint(signal);
  }
  return {
    files,
    diagnostics: files.flatMap((file) => file.diagnostics)
  };
}
