import type { Node as SyntaxNode } from "web-tree-sitter";
import {
  type CComment,
  type CDirectCall,
  type CEnumDefinition,
  type CFunctionDefinition,
  type CFunctionParameter,
  type CFunctionPointerTableReference,
  type CGlobalVariableDeclaration,
  type CIntegerMacroDefinition,
  type CPackDirective,
  type CParseDiagnostic,
  type CParsedFile,
  type CProjectModel,
  type CRecordDefinition,
  type CRecordMember,
  type CSourceInput,
  type CSourceRange,
  type CTypeReference,
  type CTypedefDefinition
} from "./cProjectModels";
import { createCParser } from "./treeSitterRuntime";

const TYPE_NODE_TYPES = new Set([
  "primitive_type",
  "sized_type_specifier",
  "type_identifier",
  "struct_specifier",
  "union_specifier",
  "enum_specifier"
]);

export async function parseCProject(inputs: CSourceInput[]): Promise<CProjectModel> {
  const files = await Promise.all(inputs.map((input) => parseCSource(input)));
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    files,
    diagnostics: files.flatMap((file) => file.diagnostics)
  };
}

export async function parseCSource(input: CSourceInput): Promise<CParsedFile> {
  const relativePath = normalizeProjectPath(input.relativePath);
  const parser = await createCParser();
  const tree = parser.parse(input.content);
  if (!tree) {
    parser.delete();
    throw new Error(`Tree-sitter did not return a syntax tree for ${relativePath}`);
  }

  try {
    const root = tree.rootNode;
    const topLevelDeclarations = collectTranslationUnitNodes(
      root,
      new Set(["declaration", "type_definition"])
    );
    const topLevelTypeContainers = collectTranslationUnitNodes(
      root,
      new Set([
        "declaration",
        "type_definition",
        "struct_specifier",
        "union_specifier",
        "enum_specifier"
      ])
    );
    return {
      relativePath,
      functions: collectTranslationUnitNodes(root, new Set(["function_definition"]))
        .map((node) => parseFunction(node, input.content, relativePath)),
      globalVariables: topLevelDeclarations
        .filter((node) => node.type === "declaration")
        .flatMap((node) => parseGlobalVariables(node, input.content, relativePath)),
      records: topLevelTypeContainers
        .flatMap((node) => collectNodes(node, new Set(["struct_specifier", "union_specifier"])))
        .filter((node) => node.childForFieldName("body"))
        .map((node) => parseRecord(node, input.content, relativePath)),
      typedefs: topLevelDeclarations
        .filter((node) => node.type === "type_definition")
        .flatMap((node) => parseTypedefs(node, input.content, relativePath)),
      enums: topLevelTypeContainers
        .flatMap((node) => collectNodes(node, new Set(["enum_specifier"])))
        .filter((node) => node.childForFieldName("body"))
        .map((node) => parseEnum(node, input.content, relativePath)),
      integerMacros: collectNodes(root, new Set(["preproc_def"]))
        .map((node) => parseIntegerMacro(node, input.content, relativePath))
        .filter((macro): macro is CIntegerMacroDefinition => Boolean(macro)),
      packDirectives: collectNodes(root, new Set(["preproc_call"]))
        .map((node) => parsePackDirective(node, input.content, relativePath))
        .filter((directive): directive is CPackDirective => Boolean(directive)),
      comments: collectNodes(root, new Set(["comment"]))
        .map((node) => parseComment(node, input.content, relativePath)),
      diagnostics: collectDiagnostics(root, input.content, relativePath)
    };
  } finally {
    tree.delete();
    parser.delete();
  }
}

export function normalizeProjectPath(relativePath: string): string {
  let normalized = relativePath.replaceAll("\\", "/").trim();
  normalized = normalized.replace(/^\$\/+/, "").replace(/^\.\/+/, "").replace(/^\/+/, "");
  return `$/${normalized}`;
}

function parseFunction(node: SyntaxNode, source: string, relativePath: string): CFunctionDefinition {
  const declarator = requiredField(node, "declarator");
  const functionDeclarator = findDeclaratorNode(declarator, "function_declarator") ?? declarator;
  const name = declaratorName(declarator);
  if (!name) {
    throw new Error(`Unable to identify function at ${relativePath}:${node.startPosition.row + 1}`);
  }
  const body = requiredField(node, "body");
  const parametersNode = functionDeclarator.childForFieldName("parameters");
  const parameters = parametersNode
    ? parametersNode.namedChildren
      .filter((child) => child.type === "parameter_declaration")
      .map((child) => parseParameter(child, source))
      .filter((parameter, index, all) => !(
        all.length === 1
        && index === 0
        && parameter.name === undefined
        && parameter.type.baseType === "void"
      ))
    : [];

  return {
    id: `${relativePath}::function::${name}`,
    name,
    relativePath,
    declaration: source.slice(node.startIndex, body.startIndex).trim(),
    body: sourceText(body, source),
    storageClasses: directChildTexts(node, "storage_class_specifier", source),
    returnType: {
      ...parseTypeReference(node, declarator, source),
      isFunction: false
    },
    parameters,
    calls: collectDirectCalls(body),
    functionPointerTableReferences: collectFunctionPointerTableReferences(body, source),
    localVariableNames: collectLocalVariableNames(body),
    range: sourceRange(node),
    bodyRange: sourceRange(body)
  };
}

function parseParameter(node: SyntaxNode, source: string): CFunctionParameter {
  const declarator = node.childForFieldName("declarator");
  return {
    name: declarator ? declaratorName(declarator) : undefined,
    declaration: sourceText(node, source),
    type: parseTypeReference(node, declarator, source),
    range: sourceRange(node)
  };
}

function parseGlobalVariables(
  node: SyntaxNode,
  source: string,
  relativePath: string
): CGlobalVariableDeclaration[] {
  const storageClasses = directChildTexts(node, "storage_class_specifier", source);
  return node.childrenForFieldName("declarator").flatMap((candidate) => {
    const { declarator, initializer } = unwrapInitializer(candidate);
    const type = parseTypeReference(node, declarator, source);
    if (type.isFunction) {
      return [];
    }
    const name = declaratorName(declarator);
    if (!name) {
      return [];
    }
    return [{
      id: `${relativePath}::global::${name}`,
      name,
      relativePath,
      declaration: sourceText(node, source),
      declarator: sourceText(declarator, source),
      initializer: initializer ? sourceText(initializer, source) : undefined,
      storageClasses,
      type,
      range: sourceRange(declarator),
      declarationRange: sourceRange(node)
    }];
  });
}

function parseTypedefs(node: SyntaxNode, source: string, relativePath: string): CTypedefDefinition[] {
  return node.childrenForFieldName("declarator").flatMap((declarator) => {
    const name = declaratorName(declarator);
    if (!name) {
      return [];
    }
    return [{
      id: `${relativePath}::typedef::${name}`,
      name,
      relativePath,
      declaration: sourceText(node, source),
      targetType: parseTypeReference(node, declarator, source),
      range: sourceRange(declarator)
    }];
  });
}

function parseRecord(node: SyntaxNode, source: string, relativePath: string): CRecordDefinition {
  const kind = node.type === "struct_specifier" ? "struct" : "union";
  const name = node.childForFieldName("name")?.text;
  const parentDeclarationNode = findDeclarationAncestor(node);
  const body = requiredField(node, "body");
  return {
    id: name
      ? `${kind}::${name}`
      : `${relativePath}::anonymous-${kind}::${node.startIndex}`,
    kind,
    name,
    relativePath,
    declaration: sourceText(node, source),
    parentDeclaration: sourceText(parentDeclarationNode ?? node, source),
    members: body.namedChildren
      .filter((child) => child.type === "field_declaration")
      .flatMap((child) => parseRecordMembers(child, source)),
    range: sourceRange(node)
  };
}

function parseRecordMembers(node: SyntaxNode, source: string): CRecordMember[] {
  const declarators = node.childrenForFieldName("declarator");
  const bitWidths = node.namedChildren
    .filter((child) => child.type === "bitfield_clause")
    .map((child) => child.namedChild(0)?.text ?? child.text.replace(/^:\s*/, ""));

  if (declarators.length === 0) {
    return [{
      declaration: sourceText(node, source),
      type: parseTypeReference(node, null, source),
      bitWidthExpression: bitWidths[0],
      range: sourceRange(node),
      declarationRange: sourceRange(node)
    }];
  }

  return declarators.map((declarator, index) => ({
    name: declaratorName(declarator),
    declaration: sourceText(node, source),
    type: parseTypeReference(node, declarator, source),
    bitWidthExpression: bitWidths[index] ?? (bitWidths.length === 1 ? bitWidths[0] : undefined),
    range: sourceRange(declarator),
    declarationRange: sourceRange(node)
  }));
}

function parseEnum(node: SyntaxNode, source: string, relativePath: string): CEnumDefinition {
  const name = node.childForFieldName("name")?.text;
  const body = requiredField(node, "body");
  return {
    id: name ? `enum::${name}` : `${relativePath}::anonymous-enum::${node.startIndex}`,
    name,
    relativePath,
    declaration: sourceText(node, source),
    enumerators: body.namedChildren
      .filter((child) => child.type === "enumerator")
      .map((enumerator) => ({
        name: enumerator.childForFieldName("name")?.text ?? enumerator.namedChild(0)?.text ?? "",
        ...(enumerator.childForFieldName("value")
          ? { valueExpression: enumerator.childForFieldName("value")?.text }
          : {})
      })),
    range: sourceRange(node)
  };
}

function parseIntegerMacro(
  node: SyntaxNode,
  source: string,
  relativePath: string
): CIntegerMacroDefinition | undefined {
  const name = node.childForFieldName("name")?.text;
  const value = node.childForFieldName("value")?.text.trim();
  if (!name || !value) {
    return undefined;
  }
  return {
    name,
    expression: value,
    relativePath,
    range: sourceRange(node)
  };
}

function parsePackDirective(
  node: SyntaxNode,
  source: string,
  relativePath: string
): CPackDirective | undefined {
  if (node.childForFieldName("directive")?.text.trim() !== "#pragma") {
    return undefined;
  }
  const argument = node.childForFieldName("argument")?.text.trim() ?? "";
  const match = argument.match(/^pack\s*\((.*)\)\s*$/i);
  if (!match) {
    return undefined;
  }
  const parts = match[1].split(",").map((part) => part.trim()).filter(Boolean);
  let action: CPackDirective["action"];
  let valueExpression: string | undefined;
  if (parts.length === 0) {
    action = "reset";
  } else if (parts[0].toLowerCase() === "push") {
    action = "push";
    valueExpression = parts.at(-1) === parts[0] ? undefined : parts.at(-1);
  } else if (parts[0].toLowerCase() === "pop") {
    action = "pop";
  } else {
    action = "set";
    valueExpression = parts[0];
  }
  const value = valueExpression ? parseIntegerLiteral(valueExpression) : undefined;
  return {
    action,
    ...(value !== undefined ? { value } : {}),
    ...(valueExpression && value === undefined ? { valueExpression } : {}),
    relativePath,
    range: sourceRange(node)
  };
}

function parseComment(node: SyntaxNode, source: string, relativePath: string): CComment {
  const text = sourceText(node, source);
  return {
    text,
    style: text.startsWith("//") ? "line" : "block",
    relativePath,
    range: sourceRange(node)
  };
}

function collectDiagnostics(
  root: SyntaxNode,
  source: string,
  relativePath: string
): CParseDiagnostic[] {
  return collectNodes(root, new Set(["ERROR"]), true)
    .filter((node) => node.isError || node.isMissing)
    .map((node) => ({
      message: node.isMissing
        ? `Missing ${node.type}`
        : `Syntax error near ${JSON.stringify(sourceText(node, source).slice(0, 80))}`,
      relativePath,
      range: sourceRange(node)
    }));
}

function collectDirectCalls(body: SyntaxNode): CDirectCall[] {
  return collectNodes(body, new Set(["call_expression"]))
    .flatMap((call) => {
      const callee = call.childForFieldName("function");
      if (!callee || callee.type !== "identifier") {
        return [];
      }
      return [{ callee: callee.text, range: sourceRange(call) }];
    });
}

function collectFunctionPointerTableReferences(
  body: SyntaxNode,
  source: string
): CFunctionPointerTableReference[] {
  return collectNodes(body, new Set(["declaration"]))
    .flatMap((declaration) => {
      const hasDeclarationTableQualifier = (
        directChildTexts(declaration, "storage_class_specifier", source).includes("static")
        || directChildTexts(declaration, "type_qualifier", source).includes("const")
      );
      return declaration.childrenForFieldName("declarator").flatMap((candidate) => {
        const { declarator, initializer } = unwrapInitializer(candidate);
        if (
          !initializer
          || !findDeclaratorNode(declarator, "array_declarator")
          || (!hasDeclarationTableQualifier && !declaratorHasConstQualifier(declarator, source))
        ) {
          return [];
        }

        const tableName = declaratorName(declarator);
        if (!tableName) {
          return [];
        }

        return collectInitializerReferenceIdentifiers(initializer).map((callee) => ({
          callee: callee.text,
          tableName,
          range: sourceRange(callee)
        }));
      });
    });
}

function declaratorHasConstQualifier(declarator: SyntaxNode, source: string): boolean {
  return collectNodes(declarator, new Set(["type_qualifier"]))
    .some((qualifier) => sourceText(qualifier, source) === "const");
}

function collectInitializerReferenceIdentifiers(initializer: SyntaxNode): SyntaxNode[] {
  const references: SyntaxNode[] = [];
  const visit = (node: SyntaxNode, insideInitializerList: boolean): void => {
    if (node.type === "field_designator" || node.type === "subscript_designator") {
      return;
    }
    if (node.type === "pointer_expression") {
      const argument = node.childForFieldName("argument");
      if (insideInitializerList && argument?.type === "identifier") {
        references.push(argument);
      }
      return;
    }
    if (insideInitializerList && node.type === "identifier") {
      references.push(node);
      return;
    }

    const childInsideInitializerList = insideInitializerList || node.type === "initializer_list";
    for (const child of node.namedChildren) {
      visit(child, childInsideInitializerList);
    }
  };

  visit(initializer, initializer.type === "initializer_list");
  return references;
}

function collectLocalVariableNames(body: SyntaxNode): string[] {
  const names = collectNodes(body, new Set(["declaration"]))
    .flatMap((declaration) => declaration.childrenForFieldName("declarator"))
    .map((candidate) => unwrapInitializer(candidate).declarator)
    .map((declarator) => declaratorName(declarator))
    .filter((name): name is string => Boolean(name));
  return [...new Set(names)].sort();
}

function parseTypeReference(
  owner: SyntaxNode,
  declarator: SyntaxNode | null,
  source: string
): CTypeReference {
  const typeNode = owner.childForFieldName("type")
    ?? owner.namedChildren.find((child) => TYPE_NODE_TYPES.has(child.type));
  const qualifiers = directChildTexts(owner, "type_qualifier", source);
  const declaratorShape = declaratorDetails(declarator);
  const baseType = typeNode ? baseTypeName(typeNode) : "";
  const raw = [
    ...qualifiers,
    baseType,
    declaratorShape.pointerDepth > 0 ? "*".repeat(declaratorShape.pointerDepth) : ""
  ].filter(Boolean).join(" ");
  return {
    raw,
    baseType,
    qualifiers,
    pointerDepth: declaratorShape.pointerDepth,
    arrayDimensions: declaratorShape.arrayDimensions,
    isFunction: declaratorShape.isFunction
  };
}

function declaratorDetails(node: SyntaxNode | null): {
  pointerDepth: number;
  arrayDimensions: string[];
  isFunction: boolean;
} {
  let current = node;
  let pointerDepth = 0;
  const arrayDimensions: string[] = [];
  let isFunction = false;
  while (current) {
    if (current.type === "pointer_declarator" || current.type === "abstract_pointer_declarator") {
      pointerDepth += 1;
    } else if (current.type === "array_declarator" || current.type === "abstract_array_declarator") {
      arrayDimensions.unshift(current.childForFieldName("size")?.text.trim() ?? "");
    } else if (current.type === "function_declarator" || current.type === "abstract_function_declarator") {
      isFunction = true;
    }
    current = nextDeclaratorNode(current);
  }
  return { pointerDepth, arrayDimensions, isFunction };
}

function baseTypeName(node: SyntaxNode): string {
  if (node.type === "struct_specifier" || node.type === "union_specifier" || node.type === "enum_specifier") {
    const kind = node.type.replace("_specifier", "");
    const name = node.childForFieldName("name")?.text;
    return name ? `${kind} ${name}` : `anonymous ${kind}`;
  }
  return node.text.trim().replace(/\s+/g, " ");
}

function declaratorName(node: SyntaxNode): string | undefined {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "identifier" || current.type === "field_identifier" || current.type === "type_identifier") {
      return current.text;
    }
    current = nextDeclaratorNode(current)
      ?? current.namedChildren.find((child) => (
        child.type === "identifier"
        || child.type === "field_identifier"
        || child.type === "type_identifier"
      ))
      ?? null;
  }
  return undefined;
}

function findDeclaratorNode(node: SyntaxNode, type: string): SyntaxNode | undefined {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === type) {
      return current;
    }
    current = nextDeclaratorNode(current);
  }
  return undefined;
}

function nextDeclaratorNode(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName("declarator")
    ?? node.namedChildren.find((child) => (
      child.type.includes("declarator")
      || child.type === "identifier"
      || child.type === "field_identifier"
      || child.type === "type_identifier"
    ))
    ?? null;
}

function unwrapInitializer(node: SyntaxNode): {
  declarator: SyntaxNode;
  initializer: SyntaxNode | null;
} {
  if (node.type === "init_declarator") {
    return {
      declarator: requiredField(node, "declarator"),
      initializer: node.childForFieldName("value")
    };
  }
  return { declarator: node, initializer: null };
}

function collectNodes(root: SyntaxNode, types: Set<string>, includeMissing = false): SyntaxNode[] {
  const matches: SyntaxNode[] = [];
  const visit = (node: SyntaxNode): void => {
    if (types.has(node.type) || (includeMissing && node.isMissing)) {
      matches.push(node);
    }
    for (const child of node.namedChildren) {
      visit(child);
    }
  };
  visit(root);
  return matches;
}

function collectTranslationUnitNodes(root: SyntaxNode, types: Set<string>): SyntaxNode[] {
  const matches: SyntaxNode[] = [];
  const visit = (node: SyntaxNode): void => {
    if (types.has(node.type)) {
      matches.push(node);
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
  return matches;
}

function directChildTexts(node: SyntaxNode, type: string, source: string): string[] {
  return node.namedChildren
    .filter((child) => child.type === type)
    .map((child) => sourceText(child, source));
}

function findDeclarationAncestor(node: SyntaxNode): SyntaxNode | undefined {
  let current = node.parent;
  while (current) {
    if (
      current.type === "declaration"
      || current.type === "type_definition"
      || current.type === "field_declaration"
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function requiredField(node: SyntaxNode, fieldName: string): SyntaxNode {
  const child = node.childForFieldName(fieldName);
  if (!child) {
    throw new Error(`Expected ${node.type} to have ${fieldName}`);
  }
  return child;
}

function sourceText(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex).trim();
}

function sourceRange(node: SyntaxNode): CSourceRange {
  return {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: {
      row: node.startPosition.row,
      column: node.startPosition.column
    },
    endPosition: {
      row: node.endPosition.row,
      column: node.endPosition.column
    }
  };
}

function parseIntegerLiteral(value: string): number | undefined {
  if (/^0[xX][0-9a-fA-F]+$/.test(value)) {
    return Number.parseInt(value.slice(2), 16);
  }
  if (/^[0-9]+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return undefined;
}
