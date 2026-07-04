import type { Node as SyntaxNode, Parser, Tree } from "web-tree-sitter";
import type { FilePairStatus } from "./types";
import { createCParser } from "./treeSitterRuntime";

const PATH_MARKER_NODE_TYPES = new Set([
  "if_statement",
  "switch_statement",
  "case_statement",
  "for_statement",
  "while_statement",
  "do_statement",
  "conditional_expression"
]);

export interface SourceLineRange {
  startLine: number;
  endLine: number;
}

export type CPathReviewMarkerReason =
  | "function-entry"
  | "changed-executable"
  | "changed-branch"
  | "added-branch"
  | "deleted-code-fallback";

export interface CPathReviewMarker {
  afterLine: number;
  reason: CPathReviewMarkerReason;
}

export type CPathSourceLineKind =
  | "blank"
  | "comment"
  | "brace"
  | "declaration"
  | "branch"
  | "case"
  | "executable";

export interface CPathSourceLineFact {
  line: number;
  kind: CPathSourceLineKind;
  normalizedCode: string;
}

export interface CPathFunctionPlan {
  name: string;
  status: "modified" | "added";
  beforeRange?: SourceLineRange;
  beforeBodyStartLine?: number;
  afterRange: SourceLineRange;
  afterBodyStartLine: number;
  commentLines: ReadonlySet<number>;
  newFunctionMarkerLines: ReadonlySet<number>;
  newFunctionReviewMarkers: ReadonlyArray<CPathReviewMarker>;
}

export interface CPathFilePlan {
  functions: CPathFunctionPlan[];
  beforeCodeByLine: ReadonlyMap<number, string>;
  afterCodeByLine: ReadonlyMap<number, string>;
  beforeCommentLines: ReadonlySet<number>;
  afterCommentLines: ReadonlySet<number>;
  beforeLineFacts: ReadonlyMap<number, CPathSourceLineFact>;
  afterLineFacts: ReadonlyMap<number, CPathSourceLineFact>;
}

export interface AnalyzeCPathChangesInput {
  status: FilePairStatus;
  relativePath?: string;
  beforeSource?: string;
  afterSource?: string;
}

interface ParsedFunction {
  name: string;
  range: SourceLineRange;
  bodyStartLine: number;
  normalizedBody: string;
  commentLines: Set<number>;
  newFunctionMarkerLines: Set<number>;
}

interface ParsedSource {
  functions: ParsedFunction[];
  codeByLine: Map<number, string>;
  commentLines: Set<number>;
  lineFacts: Map<number, CPathSourceLineFact>;
}

export async function analyzeCPathChanges(
  input: AnalyzeCPathChangesInput
): Promise<CPathFilePlan> {
  if (!isCSource(input.relativePath ?? "source.c") || input.status === "deleted") {
    return emptyPlan();
  }

  const parser = await createCParser();
  try {
    const before = parseSource(parser, input.beforeSource ?? "");
    const after = parseSource(parser, input.afterSource ?? "");
    const beforeByName = new Map(before.functions.map((fn) => [fn.name, fn]));
    const functions: CPathFunctionPlan[] = [];

    for (const afterFunction of after.functions) {
      const beforeFunction = beforeByName.get(afterFunction.name);
      if (!beforeFunction) {
        functions.push(toFunctionPlan(afterFunction, "added"));
        continue;
      }
      if (beforeFunction.normalizedBody !== afterFunction.normalizedBody) {
        functions.push({
          ...toFunctionPlan(afterFunction, "modified"),
          beforeRange: beforeFunction.range,
          beforeBodyStartLine: beforeFunction.bodyStartLine
        });
      }
    }

    return {
      functions,
      beforeCodeByLine: before.codeByLine,
      afterCodeByLine: after.codeByLine,
      beforeCommentLines: before.commentLines,
      afterCommentLines: after.commentLines,
      beforeLineFacts: before.lineFacts,
      afterLineFacts: after.lineFacts
    };
  } finally {
    parser.delete();
  }
}

function parseSource(parser: Parser, source: string): ParsedSource {
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error("Tree-sitter did not return a syntax tree for C path analysis");
  }

  try {
    const comments = collectNodes(tree.rootNode, new Set(["comment"]));
    const commentLines = lineSetForNodes(comments);
    const codeByLine = sourceLinesWithoutComments(source, comments);
    const functions = collectTranslationUnitFunctions(tree)
      .map((node) => parseFunction(node, source));
    const lineFacts = sourceLineFacts(source, tree.rootNode, codeByLine, commentLines);
    return { functions, codeByLine, commentLines, lineFacts };
  } finally {
    tree.delete();
  }
}

function collectTranslationUnitFunctions(tree: Tree): SyntaxNode[] {
  const functions: SyntaxNode[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.type === "function_definition") {
      functions.push(node);
      return;
    }
    if (node.type !== "translation_unit" && !node.type.startsWith("preproc_")) {
      return;
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  };
  visit(tree.rootNode);
  return functions;
}

function parseFunction(node: SyntaxNode, source: string): ParsedFunction {
  const declarator = node.childForFieldName("declarator");
  const body = node.childForFieldName("body");
  const name = declarator ? declaratorName(declarator) : undefined;
  if (!name || !body) {
    throw new Error(`Unable to identify C function at line ${node.startPosition.row + 1}`);
  }

  const comments = collectNodes(body, new Set(["comment"]));
  const commentLines = lineSetForNodes(comments);
  const markerLines = new Set<number>([body.startPosition.row + 1]);
  walkNamedNodes(body, (candidate) => {
    if (PATH_MARKER_NODE_TYPES.has(candidate.type)) {
      markerLines.add(candidate.startPosition.row + 1);
    }
    if (candidate.type === "if_statement") {
      const alternative = candidate.childForFieldName("alternative");
      if (alternative) {
        markerLines.add(alternative.startPosition.row + 1);
      }
    }
  });
  for (const commentLine of commentLines) {
    markerLines.delete(commentLine);
  }

  return {
    name,
    range: nodeLineRange(node),
    bodyStartLine: body.startPosition.row + 1,
    normalizedBody: normalizeCode(removeNodeRanges(
      source.slice(body.startIndex, body.endIndex),
      comments.map((comment) => ({
        startIndex: comment.startIndex - body.startIndex,
        endIndex: comment.endIndex - body.startIndex
      }))
    )),
    commentLines,
    newFunctionMarkerLines: new Set([...markerLines].sort((left, right) => left - right))
  };
}

function toFunctionPlan(
  fn: ParsedFunction,
  status: CPathFunctionPlan["status"]
): CPathFunctionPlan {
  const newFunctionReviewMarkers = status === "added"
    ? [...fn.newFunctionMarkerLines].map((afterLine) => ({
        afterLine,
        reason: afterLine === fn.bodyStartLine ? "function-entry" : "added-branch"
      } satisfies CPathReviewMarker))
    : [];
  return {
    name: fn.name,
    status,
    afterRange: fn.range,
    afterBodyStartLine: fn.bodyStartLine,
    commentLines: fn.commentLines,
    newFunctionMarkerLines: fn.newFunctionMarkerLines,
    newFunctionReviewMarkers
  };
}

function sourceLineFacts(
  source: string,
  root: SyntaxNode,
  codeByLine: Map<number, string>,
  commentLines: Set<number>
): Map<number, CPathSourceLineFact> {
  const declarationLines = functionDeclarationLines(root);
  const branchLines = new Set<number>();
  const caseLines = new Set<number>();

  walkNamedNodes(root, (node) => {
    if (node.type === "case_statement") {
      caseLines.add(node.startPosition.row + 1);
      return;
    }
    if (PATH_MARKER_NODE_TYPES.has(node.type)) {
      branchLines.add(node.startPosition.row + 1);
    }
    if (node.type === "if_statement") {
      const alternative = node.childForFieldName("alternative");
      if (alternative) {
        branchLines.add(alternative.startPosition.row + 1);
      }
    }
  });

  const facts = new Map<number, CPathSourceLineFact>();
  const lineCount = source.length === 0 ? 0 : source.split(/\r?\n/).length;
  for (let line = 1; line <= lineCount; line += 1) {
    const normalizedCode = normalizeCode(codeByLine.get(line) ?? "");
    facts.set(line, {
      line,
      kind: sourceLineKind(line, normalizedCode, {
        commentLines,
        declarationLines,
        branchLines,
        caseLines
      }),
      normalizedCode
    });
  }

  return facts;
}

function sourceLineKind(
  line: number,
  normalizedCode: string,
  markers: {
    commentLines: Set<number>;
    declarationLines: Set<number>;
    branchLines: Set<number>;
    caseLines: Set<number>;
  }
): CPathSourceLineKind {
  if (normalizedCode.length === 0) {
    return markers.commentLines.has(line) ? "comment" : "blank";
  }
  if (markers.declarationLines.has(line)) {
    return "declaration";
  }
  if (markers.caseLines.has(line)) {
    return "case";
  }
  if (markers.branchLines.has(line)) {
    return "branch";
  }
  if (/^[{};]+$/.test(normalizedCode)) {
    return "brace";
  }
  return "executable";
}

function functionDeclarationLines(root: SyntaxNode): Set<number> {
  const lines = new Set<number>();
  for (const fn of collectTranslationUnitFunctionsFromRoot(root)) {
    const body = fn.childForFieldName("body");
    if (!body) {
      continue;
    }
    for (
      let line = fn.startPosition.row + 1;
      line < body.startPosition.row + 1;
      line += 1
    ) {
      lines.add(line);
    }
  }
  return lines;
}

function collectTranslationUnitFunctionsFromRoot(root: SyntaxNode): SyntaxNode[] {
  const functions: SyntaxNode[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.type === "function_definition") {
      functions.push(node);
      return;
    }
    if (node.type !== "translation_unit" && !node.type.startsWith("preproc_")) {
      return;
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  };
  visit(root);
  return functions;
}

function sourceLinesWithoutComments(
  source: string,
  comments: SyntaxNode[]
): Map<number, string> {
  const withoutComments = removeNodeRanges(
    source,
    comments.map((comment) => ({
      startIndex: comment.startIndex,
      endIndex: comment.endIndex
    }))
  );
  return new Map(withoutComments.split(/\r?\n/).map((line, index) => [index + 1, line]));
}

function removeNodeRanges(
  source: string,
  ranges: Array<{ startIndex: number; endIndex: number }>
): string {
  const characters = [...source];
  for (const range of ranges) {
    for (
      let index = Math.max(0, range.startIndex);
      index < Math.min(characters.length, range.endIndex);
      index += 1
    ) {
      if (characters[index] !== "\r" && characters[index] !== "\n") {
        characters[index] = " ";
      }
    }
  }
  return characters.join("");
}

function normalizeCode(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function lineSetForNodes(nodes: SyntaxNode[]): Set<number> {
  const lines = new Set<number>();
  for (const node of nodes) {
    for (
      let line = node.startPosition.row + 1;
      line <= node.endPosition.row + 1;
      line += 1
    ) {
      lines.add(line);
    }
  }
  return lines;
}

function walkNamedNodes(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) {
    walkNamedNodes(child, visit);
  }
}

function collectNodes(root: SyntaxNode, types: Set<string>): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  walkNamedNodes(root, (node) => {
    if (types.has(node.type)) {
      nodes.push(node);
    }
  });
  return nodes;
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

function nodeLineRange(node: SyntaxNode): SourceLineRange {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1
  };
}

function isCSource(relativePath: string): boolean {
  return relativePath.replaceAll("\\", "/").toLowerCase().endsWith(".c");
}

function emptyPlan(): CPathFilePlan {
  return {
    functions: [],
    beforeCodeByLine: new Map(),
    afterCodeByLine: new Map(),
    beforeCommentLines: new Set(),
    afterCommentLines: new Set(),
    beforeLineFacts: new Map(),
    afterLineFacts: new Map()
  };
}
