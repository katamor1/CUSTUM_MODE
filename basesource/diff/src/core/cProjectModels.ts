export interface CSourcePoint {
  row: number;
  column: number;
}

export interface CSourceRange {
  startIndex: number;
  endIndex: number;
  startPosition: CSourcePoint;
  endPosition: CSourcePoint;
}

export interface CTypeReference {
  raw: string;
  baseType: string;
  qualifiers: string[];
  pointerDepth: number;
  arrayDimensions: string[];
  isFunction: boolean;
}

export interface CFunctionParameter {
  name?: string;
  declaration: string;
  type: CTypeReference;
  range: CSourceRange;
}

export interface CDirectCall {
  callee: string;
  range: CSourceRange;
}

export interface CFunctionPointerTableReference {
  callee: string;
  tableName: string;
  range: CSourceRange;
}

export interface CFunctionDefinition {
  id: string;
  name: string;
  relativePath: string;
  declaration: string;
  body: string;
  storageClasses: string[];
  returnType: CTypeReference;
  parameters: CFunctionParameter[];
  calls: CDirectCall[];
  functionPointerTableReferences: CFunctionPointerTableReference[];
  localVariableNames: string[];
  range: CSourceRange;
  bodyRange: CSourceRange;
}

export interface CGlobalVariableDeclaration {
  id: string;
  name: string;
  relativePath: string;
  declaration: string;
  declarator: string;
  initializer?: string;
  storageClasses: string[];
  type: CTypeReference;
  range: CSourceRange;
  declarationRange: CSourceRange;
}

export interface CRecordMember {
  name?: string;
  declaration: string;
  type: CTypeReference;
  bitWidthExpression?: string;
  range: CSourceRange;
  declarationRange: CSourceRange;
}

export interface CRecordDefinition {
  id: string;
  kind: "struct" | "union";
  name?: string;
  relativePath: string;
  declaration: string;
  parentDeclaration: string;
  members: CRecordMember[];
  range: CSourceRange;
}

export interface CTypedefDefinition {
  id: string;
  name: string;
  relativePath: string;
  declaration: string;
  targetType: CTypeReference;
  range: CSourceRange;
}

export interface CEnumerator {
  name: string;
  valueExpression?: string;
}

export interface CEnumDefinition {
  id: string;
  name?: string;
  relativePath: string;
  declaration: string;
  enumerators: CEnumerator[];
  range: CSourceRange;
}

export interface CIntegerMacroDefinition {
  name: string;
  expression: string;
  relativePath: string;
  range: CSourceRange;
}

export interface CPackDirective {
  action: "push" | "pop" | "set" | "reset";
  value?: number;
  valueExpression?: string;
  relativePath: string;
  range: CSourceRange;
}

export interface CComment {
  text: string;
  style: "line" | "block";
  relativePath: string;
  range: CSourceRange;
}

export interface CParseDiagnostic {
  message: string;
  relativePath: string;
  range: CSourceRange;
}

export interface CParsedFile {
  relativePath: string;
  functions: CFunctionDefinition[];
  globalVariables: CGlobalVariableDeclaration[];
  records: CRecordDefinition[];
  typedefs: CTypedefDefinition[];
  enums: CEnumDefinition[];
  integerMacros: CIntegerMacroDefinition[];
  packDirectives: CPackDirective[];
  comments: CComment[];
  diagnostics: CParseDiagnostic[];
}

export interface CSourceInput {
  relativePath: string;
  content: string;
}

export interface CProjectModel {
  files: CParsedFile[];
  diagnostics: CParseDiagnostic[];
}
