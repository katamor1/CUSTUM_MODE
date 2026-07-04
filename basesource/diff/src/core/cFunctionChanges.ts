import type { Node as SyntaxNode, Parser } from "web-tree-sitter";
import type { CFunctionDefinition } from "./cProjectModels";
import { createCParser } from "./treeSitterRuntime";
import type { FilePairStatus } from "./types";

export type CFunctionChangeStatus = "modified" | "added" | "deleted";

export interface CFunctionChange {
  name: string;
  status: CFunctionChangeStatus;
}

type ComparableFunctionDefinition = Pick<CFunctionDefinition, "name" | "body">;

const parser: Parser = await createCParser();

export function extractChangedCFunctions(
  relativePath: string,
  status: FilePairStatus,
  leftContent?: string,
  rightContent?: string
): CFunctionChange[] {
  if (!relativePath.replaceAll("\\", "/").toLowerCase().endsWith(".c")) {
    return [];
  }
  return compareCFunctionDefinitions(
    status,
    parseFunctionModels(leftContent ?? ""),
    parseFunctionModels(rightContent ?? "")
  );
}

export function compareCFunctionDefinitions(
  status: FilePairStatus,
  leftFunctions: ComparableFunctionDefinition[],
  rightFunctions: ComparableFunctionDefinition[]
): CFunctionChange[] {
  if (status === "added") {
    return rightFunctions.map((definition) => ({ name: definition.name, status: "added" }));
  }
  if (status === "deleted") {
    return leftFunctions.map((definition) => ({ name: definition.name, status: "deleted" }));
  }

  const rightByName = new Map(rightFunctions.map((definition) => [definition.name, definition]));
  const leftNames = new Set(leftFunctions.map((definition) => definition.name));
  const changes: CFunctionChange[] = [];

  for (const leftFunction of leftFunctions) {
    const rightFunction = rightByName.get(leftFunction.name);
    if (!rightFunction) {
      changes.push({ name: leftFunction.name, status: "deleted" });
    } else if (normalizeFunctionBody(leftFunction.body) !== normalizeFunctionBody(rightFunction.body)) {
      changes.push({ name: leftFunction.name, status: "modified" });
    }
  }
  for (const rightFunction of rightFunctions) {
    if (!leftNames.has(rightFunction.name)) {
      changes.push({ name: rightFunction.name, status: "added" });
    }
  }
  return changes;
}

function parseFunctionModels(content: string): ComparableFunctionDefinition[] {
  const tree = parser.parse(content);
  if (!tree) {
    throw new Error("Tree-sitter did not return a syntax tree for C function comparison");
  }
  try {
    return tree.rootNode.namedChildren
      .filter((node) => node.type === "function_definition")
      .flatMap((node) => {
        const declarator = node.childForFieldName("declarator");
        const body = node.childForFieldName("body");
        const name = declarator ? declaratorName(declarator) : undefined;
        return name && body
          ? [{
            name,
            body: content.slice(body.startIndex, body.endIndex).trim()
          }]
          : [];
      });
  } finally {
    tree.delete();
  }
}

function declaratorName(node: SyntaxNode): string | undefined {
  if (node.type === "identifier") {
    return node.text;
  }
  const declarator = node.childForFieldName("declarator");
  if (declarator) {
    return declaratorName(declarator);
  }
  for (const child of node.namedChildren) {
    const name = declaratorName(child);
    if (name) {
      return name;
    }
  }
  return undefined;
}

function normalizeFunctionBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
