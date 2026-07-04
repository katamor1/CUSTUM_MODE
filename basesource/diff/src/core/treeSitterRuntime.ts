import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

export interface TreeSitterAssetPaths {
  runtimeWasmPath: string;
  cGrammarWasmPath: string;
}

export interface TreeSitterRuntimeOptions {
  assetDirectory?: string;
}

const require = createRequire(import.meta.url);
let runtimeInitialization: Promise<void> | undefined;
const languageByPath = new Map<string, Promise<Language>>();

export function resolveTreeSitterAssetPaths(options: TreeSitterRuntimeOptions = {}): TreeSitterAssetPaths {
  const localAssetDirectories = [
    options.assetDirectory,
    join(dirname(fileURLToPath(import.meta.url)), "tree-sitter-assets"),
    resolve(process.cwd(), "out/main/tree-sitter-assets")
  ].filter((value): value is string => Boolean(value));

  const runtimeCandidates = [
    ...localAssetDirectories.map((directory) => join(directory, "tree-sitter.wasm")),
    require.resolve("web-tree-sitter/web-tree-sitter.wasm")
  ];
  const grammarModuleDirectory = dirname(require.resolve("@cursorless/tree-sitter-wasms/package.json"));
  const grammarCandidates = [
    ...localAssetDirectories.map((directory) => join(directory, "tree-sitter-c.wasm")),
    join(grammarModuleDirectory, "out/tree-sitter-c.wasm")
  ];

  return {
    runtimeWasmPath: findRequiredAsset("Tree-sitter runtime", runtimeCandidates),
    cGrammarWasmPath: findRequiredAsset("Tree-sitter C grammar", grammarCandidates)
  };
}

export async function createCParser(options: TreeSitterRuntimeOptions = {}): Promise<Parser> {
  const assetPaths = resolveTreeSitterAssetPaths(options);
  runtimeInitialization ??= Parser.init({
    locateFile: () => assetPaths.runtimeWasmPath
  });
  await runtimeInitialization;

  let language = languageByPath.get(assetPaths.cGrammarWasmPath);
  if (!language) {
    language = Language.load(assetPaths.cGrammarWasmPath);
    languageByPath.set(assetPaths.cGrammarWasmPath, language);
  }

  const parser = new Parser();
  parser.setLanguage(await language);
  return parser;
}

function findRequiredAsset(label: string, candidates: string[]): string {
  const assetPath = candidates.find((candidate) => existsSync(candidate));
  if (!assetPath) {
    throw new Error(`${label} WASM asset was not found. Checked: ${candidates.join(", ")}`);
  }
  return assetPath;
}
