import { evaluateCConstantExpression } from "./cConstantExpression";
import type {
  CGlobalVariableDeclaration,
  CPackDirective,
  CProjectModel,
  CRecordDefinition,
  CRecordMember,
  CTypedefDefinition,
  CTypeReference
} from "./cProjectModels";

export const UNRESOLVED_LAYOUT = "算出不可" as const;
export type CLayoutValue = number | typeof UNRESOLVED_LAYOUT;

export interface CTypeLayoutContext {
  relativePath?: string;
  position?: number;
}

export interface CTypeLayoutResult {
  sizeBytes: CLayoutValue;
  alignmentBytes: CLayoutValue;
  arrayDimensions: CLayoutValue[];
  elementCount: CLayoutValue;
}

export interface CRecordMemberLayout extends CTypeLayoutResult {
  name: string;
  offsetBytes: CLayoutValue;
}

export interface CRecordLayoutResult extends CTypeLayoutResult {
  members: CRecordMemberLayout[];
}

export interface CTypeLayoutResolver {
  layoutType(type: CTypeReference, context?: CTypeLayoutContext): CTypeLayoutResult;
  layoutVariable(variable: CGlobalVariableDeclaration): CTypeLayoutResult;
  layoutMember(member: CRecordMember, record: CRecordDefinition): CTypeLayoutResult;
  layoutRecord(record: CRecordDefinition): CRecordLayoutResult;
}

interface ProjectTypeIndex {
  constants: Map<string, string | number>;
  typedefsByName: Map<string, CTypedefDefinition[]>;
  recordsByTypeName: Map<string, CRecordDefinition[]>;
  directivesByPath: Map<string, CPackDirective[]>;
}

const DEFAULT_PACK = 8;
const POINTER_LAYOUT = scalarLayout(4, 4);
const ENUM_LAYOUT = scalarLayout(4, 4);

const BUILTIN_LAYOUTS = new Map<string, CTypeLayoutResult>([
  ["char", scalarLayout(1, 1)],
  ["signed char", scalarLayout(1, 1)],
  ["unsigned char", scalarLayout(1, 1)],
  ["_bool", scalarLayout(1, 1)],
  ["int8_t", scalarLayout(1, 1)],
  ["uint8_t", scalarLayout(1, 1)],
  ["short", scalarLayout(2, 2)],
  ["short int", scalarLayout(2, 2)],
  ["signed short", scalarLayout(2, 2)],
  ["signed short int", scalarLayout(2, 2)],
  ["unsigned short", scalarLayout(2, 2)],
  ["unsigned short int", scalarLayout(2, 2)],
  ["wchar_t", scalarLayout(2, 2)],
  ["wint_t", scalarLayout(2, 2)],
  ["int16_t", scalarLayout(2, 2)],
  ["uint16_t", scalarLayout(2, 2)],
  ["int", scalarLayout(4, 4)],
  ["signed", scalarLayout(4, 4)],
  ["signed int", scalarLayout(4, 4)],
  ["unsigned", scalarLayout(4, 4)],
  ["unsigned int", scalarLayout(4, 4)],
  ["long", scalarLayout(4, 4)],
  ["long int", scalarLayout(4, 4)],
  ["signed long", scalarLayout(4, 4)],
  ["signed long int", scalarLayout(4, 4)],
  ["unsigned long", scalarLayout(4, 4)],
  ["unsigned long int", scalarLayout(4, 4)],
  ["int32_t", scalarLayout(4, 4)],
  ["uint32_t", scalarLayout(4, 4)],
  ["intptr_t", scalarLayout(4, 4)],
  ["uintptr_t", scalarLayout(4, 4)],
  ["ptrdiff_t", scalarLayout(4, 4)],
  ["size_t", scalarLayout(4, 4)],
  ["float", scalarLayout(4, 4)],
  ["long long", scalarLayout(8, 8)],
  ["long long int", scalarLayout(8, 8)],
  ["signed long long", scalarLayout(8, 8)],
  ["signed long long int", scalarLayout(8, 8)],
  ["unsigned long long", scalarLayout(8, 8)],
  ["unsigned long long int", scalarLayout(8, 8)],
  ["int64_t", scalarLayout(8, 8)],
  ["uint64_t", scalarLayout(8, 8)],
  ["intmax_t", scalarLayout(8, 8)],
  ["uintmax_t", scalarLayout(8, 8)],
  ["double", scalarLayout(8, 8)],
  ["long double", scalarLayout(8, 8)]
]);

export function createCTypeLayoutResolver(project: CProjectModel): CTypeLayoutResolver {
  const index = buildProjectTypeIndex(project);
  const recordCache = new WeakMap<CRecordDefinition, CRecordLayoutResult>();

  const layoutType = (
    type: CTypeReference,
    context: CTypeLayoutContext = {},
    resolving: Set<string> = new Set()
  ): CTypeLayoutResult => {
    const dimensions = evaluateDimensions(type.arrayDimensions, index.constants);
    const baseLayout = resolveBaseLayout(type, context, resolving);
    return applyArrayDimensions(baseLayout, dimensions);
  };

  const resolveBaseLayout = (
    type: CTypeReference,
    context: CTypeLayoutContext,
    resolving: Set<string>
  ): CTypeLayoutResult => {
    if (type.pointerDepth > 0) {
      return POINTER_LAYOUT;
    }
    if (type.isFunction) {
      return unresolvedLayout();
    }

    const baseType = canonicalTypeName(type.baseType);
    const builtin = BUILTIN_LAYOUTS.get(baseType.toLowerCase());
    if (builtin) {
      return builtin;
    }
    if (baseType.toLowerCase().startsWith("enum ")) {
      return ENUM_LAYOUT;
    }

    const typedef = selectDefinition(index.typedefsByName.get(baseType), context.relativePath);
    if (typedef) {
      const key = `typedef:${typedef.relativePath}:${typedef.name}:${typedef.range.startIndex}`;
      if (resolving.has(key)) {
        return unresolvedLayout();
      }
      const nested = new Set(resolving);
      nested.add(key);
      return layoutType(typedef.targetType, {
        relativePath: typedef.relativePath,
        position: typedef.range.startIndex
      }, nested);
    }

    const record = selectDefinition(index.recordsByTypeName.get(baseType), context.relativePath);
    if (record) {
      return layoutRecordInternal(record, resolving);
    }
    return unresolvedLayout();
  };

  const layoutRecordInternal = (
    record: CRecordDefinition,
    resolving: Set<string>
  ): CRecordLayoutResult => {
    const cached = recordCache.get(record);
    if (cached) {
      return cached;
    }
    const key = recordKey(record);
    if (resolving.has(key)) {
      return unresolvedRecordLayout(record);
    }
    const nested = new Set(resolving);
    nested.add(key);
    const pack = packAt(index, record);
    if (pack === undefined) {
      const unresolved = unresolvedRecordLayout(record);
      recordCache.set(record, unresolved);
      return unresolved;
    }

    let offset = 0;
    let largestSize = 0;
    let recordAlignment = 1;
    let unresolved = false;
    const members: CRecordMemberLayout[] = [];

    for (const member of record.members) {
      const memberLayout = member.bitWidthExpression
        ? unresolvedLayout(evaluateDimensions(member.type.arrayDimensions, index.constants))
        : layoutType(member.type, {
          relativePath: record.relativePath,
          position: member.range.startIndex
        }, nested);
      const memberAlignment = numeric(memberLayout.alignmentBytes);
      const memberSize = numeric(memberLayout.sizeBytes);
      if (memberAlignment === undefined || memberSize === undefined) {
        unresolved = true;
        members.push({
          name: member.name ?? "匿名",
          offsetBytes: UNRESOLVED_LAYOUT,
          ...memberLayout
        });
        continue;
      }

      const effectiveAlignment = Math.min(memberAlignment, pack);
      recordAlignment = Math.max(recordAlignment, effectiveAlignment);
      if (record.kind === "struct") {
        offset = alignUp(offset, effectiveAlignment);
        members.push({
          name: member.name ?? "匿名",
          offsetBytes: offset,
          ...memberLayout,
          alignmentBytes: effectiveAlignment
        });
        offset = checkedAdd(offset, memberSize);
      } else {
        members.push({
          name: member.name ?? "匿名",
          offsetBytes: 0,
          ...memberLayout,
          alignmentBytes: effectiveAlignment
        });
        largestSize = Math.max(largestSize, memberSize);
      }
    }

    const result: CRecordLayoutResult = unresolved
      ? {
        ...unresolvedLayout(),
        members
      }
      : {
        sizeBytes: alignUp(record.kind === "struct" ? offset : largestSize, recordAlignment),
        alignmentBytes: recordAlignment,
        arrayDimensions: [],
        elementCount: 1,
        members
      };
    recordCache.set(record, result);
    return result;
  };

  const layoutRecord = (record: CRecordDefinition): CRecordLayoutResult => (
    layoutRecordInternal(record, new Set())
  );

  return {
    layoutType: (type, context = {}) => layoutType(type, context),
    layoutVariable: (variable) => layoutType(variable.type, {
      relativePath: variable.relativePath,
      position: variable.range.startIndex
    }),
    layoutMember: (member, record) => (
      member.bitWidthExpression
        ? unresolvedLayout(evaluateDimensions(member.type.arrayDimensions, index.constants))
        : layoutType(member.type, {
          relativePath: record.relativePath,
          position: member.range.startIndex
        })
    ),
    layoutRecord
  };
}

function buildProjectTypeIndex(project: CProjectModel): ProjectTypeIndex {
  const typedefsByName = new Map<string, CTypedefDefinition[]>();
  const recordsByTypeName = new Map<string, CRecordDefinition[]>();
  const directivesByPath = new Map<string, CPackDirective[]>();
  const constants = new Map<string, string | number>();
  const ambiguousConstants = new Set<string>();

  for (const file of project.files) {
    for (const macro of file.integerMacros) {
      addConstant(constants, ambiguousConstants, macro.name, macro.expression);
    }
    for (const typedef of file.typedefs) {
      addDefinition(typedefsByName, typedef.name, typedef);
    }
    for (const record of file.records) {
      if (record.name) {
        addDefinition(recordsByTypeName, `${record.kind} ${record.name}`, record);
      }
    }
    directivesByPath.set(
      file.relativePath,
      [...file.packDirectives].sort((left, right) => left.range.startIndex - right.range.startIndex)
    );
  }

  for (const file of project.files) {
    for (const definition of file.enums) {
      let previous: number | undefined;
      for (const enumerator of definition.enumerators) {
        const value = enumerator.valueExpression
          ? evaluateCConstantExpression(enumerator.valueExpression, constants)
          : previous === undefined
            ? 0
            : previous + 1;
        if (value === undefined || !Number.isSafeInteger(value)) {
          ambiguousConstants.add(enumerator.name);
          constants.delete(enumerator.name);
          previous = undefined;
        } else {
          addConstant(constants, ambiguousConstants, enumerator.name, value);
          previous = value;
        }
      }
    }
  }

  return { constants, typedefsByName, recordsByTypeName, directivesByPath };
}

function applyArrayDimensions(
  base: CTypeLayoutResult,
  dimensions: CLayoutValue[]
): CTypeLayoutResult {
  const combinedDimensions = [...dimensions, ...base.arrayDimensions];
  const ownCount = multiplyDimensions(dimensions);
  const elementCount = multiplyLayoutValues(ownCount, base.elementCount);
  const sizeBytes = multiplyLayoutValues(base.sizeBytes, ownCount);
  return {
    sizeBytes,
    alignmentBytes: base.alignmentBytes,
    arrayDimensions: combinedDimensions,
    elementCount
  };
}

function evaluateDimensions(
  dimensions: string[],
  constants: ReadonlyMap<string, string | number>
): CLayoutValue[] {
  return dimensions.map((expression) => {
    if (!expression.trim()) {
      return UNRESOLVED_LAYOUT;
    }
    const value = evaluateCConstantExpression(expression, constants);
    return value !== undefined && value > 0 ? value : UNRESOLVED_LAYOUT;
  });
}

function multiplyDimensions(dimensions: CLayoutValue[]): CLayoutValue {
  let value = 1;
  for (const dimension of dimensions) {
    if (dimension === UNRESOLVED_LAYOUT) {
      return UNRESOLVED_LAYOUT;
    }
    value = checkedMultiply(value, dimension);
  }
  return value;
}

function multiplyLayoutValues(left: CLayoutValue, right: CLayoutValue): CLayoutValue {
  if (left === UNRESOLVED_LAYOUT || right === UNRESOLVED_LAYOUT) {
    return UNRESOLVED_LAYOUT;
  }
  return checkedMultiply(left, right);
}

function packAt(index: ProjectTypeIndex, record: CRecordDefinition): number | undefined {
  let current = DEFAULT_PACK;
  const stack: number[] = [];
  for (const directive of index.directivesByPath.get(record.relativePath) ?? []) {
    if (directive.range.startIndex >= record.range.startIndex) {
      break;
    }
    if (directive.action === "push") {
      stack.push(current);
      const value = directiveValue(directive, index.constants);
      if (directive.value !== undefined || directive.valueExpression !== undefined) {
        if (value === undefined) return undefined;
        current = value;
      }
    } else if (directive.action === "pop") {
      current = stack.pop() ?? DEFAULT_PACK;
    } else if (directive.action === "set") {
      const value = directiveValue(directive, index.constants);
      if (value === undefined) return undefined;
      current = value;
    } else {
      current = DEFAULT_PACK;
    }
  }
  return current;
}

function directiveValue(
  directive: CPackDirective,
  constants: ReadonlyMap<string, string | number>
): number | undefined {
  const value = directive.value
    ?? (directive.valueExpression
      ? evaluateCConstantExpression(directive.valueExpression, constants)
      : undefined);
  return value !== undefined && [1, 2, 4, 8, 16].includes(value) ? value : undefined;
}

function selectDefinition<T extends { relativePath: string }>(
  definitions: T[] | undefined,
  relativePath?: string
): T | undefined {
  if (!definitions || definitions.length === 0) {
    return undefined;
  }
  if (relativePath) {
    const local = definitions.filter((definition) => definition.relativePath === relativePath);
    if (local.length === 1) {
      return local[0];
    }
    if (local.length > 1) {
      return undefined;
    }
  }
  return definitions.length === 1 ? definitions[0] : undefined;
}

function addDefinition<T>(map: Map<string, T[]>, name: string, definition: T): void {
  const definitions = map.get(name) ?? [];
  definitions.push(definition);
  map.set(name, definitions);
}

function addConstant(
  constants: Map<string, string | number>,
  ambiguous: Set<string>,
  name: string,
  value: string | number
): void {
  if (ambiguous.has(name)) {
    return;
  }
  const existing = constants.get(name);
  if (existing === undefined || existing === value) {
    constants.set(name, value);
  } else {
    constants.delete(name);
    ambiguous.add(name);
  }
}

function canonicalTypeName(typeName: string): string {
  return typeName.trim().replace(/\s+/g, " ");
}

function recordKey(record: CRecordDefinition): string {
  return `record:${record.relativePath}:${record.kind}:${record.name ?? "anonymous"}:${record.range.startIndex}`;
}

function scalarLayout(sizeBytes: number, alignmentBytes: number): CTypeLayoutResult {
  return {
    sizeBytes,
    alignmentBytes,
    arrayDimensions: [],
    elementCount: 1
  };
}

function unresolvedLayout(arrayDimensions: CLayoutValue[] = []): CTypeLayoutResult {
  return {
    sizeBytes: UNRESOLVED_LAYOUT,
    alignmentBytes: UNRESOLVED_LAYOUT,
    arrayDimensions,
    elementCount: multiplyDimensions(arrayDimensions)
  };
}

function unresolvedRecordLayout(record: CRecordDefinition): CRecordLayoutResult {
  return {
    ...unresolvedLayout(),
    members: record.members.map((member) => ({
      name: member.name ?? "匿名",
      offsetBytes: UNRESOLVED_LAYOUT,
      ...unresolvedLayout(evaluateDimensions(member.type.arrayDimensions, new Map()))
    }))
  };
}

function numeric(value: CLayoutValue): number | undefined {
  return value === UNRESOLVED_LAYOUT ? undefined : value;
}

function alignUp(value: number, alignment: number): number {
  return checkedMultiply(Math.ceil(value / alignment), alignment);
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new Error("Layout size exceeds safe integer range");
  }
  return value;
}

function checkedMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) {
    throw new Error("Layout size exceeds safe integer range");
  }
  return value;
}
