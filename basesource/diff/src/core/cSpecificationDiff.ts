import type {
  CFunctionDefinition,
  CGlobalVariableDeclaration,
  CProjectModel,
  CRecordDefinition,
  CRecordMember
} from "./cProjectModels";

export interface CRecordSpecificationCandidate {
  status: "new-type" | "existing-type-new-members";
  record: CRecordDefinition;
  members: CRecordMember[];
}

export interface CSpecificationDiff {
  newFunctions: CFunctionDefinition[];
  newGlobalVariables: CGlobalVariableDeclaration[];
  records: CRecordSpecificationCandidate[];
}

export function diffCSpecifications(
  before: CProjectModel,
  after: CProjectModel
): CSpecificationDiff {
  const beforeFunctionIds = new Set(
    before.files.flatMap((file) => file.functions)
      .filter((fn) => isCSourcePath(fn.relativePath))
      .map(functionIdentity)
  );
  const beforeVariableIds = new Set(
    before.files.flatMap((file) => file.globalVariables)
      .filter((variable) => isCHeaderPath(variable.relativePath))
      .map(globalVariableIdentity)
  );
  const beforeRecords = new Map(
    before.files.flatMap((file) => file.records)
      .map((record) => [recordIdentity(record), record] as const)
  );

  const newFunctions = after.files.flatMap((file) => file.functions)
    .filter((fn) => isCSourcePath(fn.relativePath))
    .filter((fn) => !beforeFunctionIds.has(functionIdentity(fn)))
    .sort(comparePathAndName);
  const newGlobalVariables = after.files.flatMap((file) => file.globalVariables)
    .filter((variable) => isCHeaderPath(variable.relativePath))
    .filter((variable) => !beforeVariableIds.has(globalVariableIdentity(variable)))
    .sort(comparePathAndName);
  const records = after.files.flatMap((file) => file.records)
    .flatMap((record): CRecordSpecificationCandidate[] => {
      const beforeRecord = beforeRecords.get(recordIdentity(record));
      if (!beforeRecord) {
        return [{
          status: "new-type",
          record,
          members: [...record.members]
        }];
      }
      const beforeMemberIds = new Set(
        beforeRecord.members.map((member) => recordMemberIdentity(beforeRecord, member))
      );
      const addedMembers = record.members.filter(
        (member) => !beforeMemberIds.has(recordMemberIdentity(record, member))
      );
      return addedMembers.length > 0
        ? [{
          status: "existing-type-new-members",
          record,
          members: addedMembers
        }]
        : [];
    })
    .sort((left, right) => (
      left.record.relativePath.localeCompare(right.record.relativePath)
      || left.record.range.startIndex - right.record.range.startIndex
    ));

  return { newFunctions, newGlobalVariables, records };
}

export function functionIdentity(fn: CFunctionDefinition): string {
  return `${fn.relativePath}::${fn.name}`;
}

export function globalVariableIdentity(variable: CGlobalVariableDeclaration): string {
  return `${variable.relativePath}::${variable.name}`;
}

export function recordIdentity(record: CRecordDefinition): string {
  if (record.name) {
    return `${record.kind}::${record.name}`;
  }
  const normalizedParent = record.parentDeclaration.trim().replace(/\s+/g, " ");
  const position = `${record.range.startPosition.row}:${record.range.startPosition.column}`;
  return `${record.relativePath}::anonymous-${record.kind}::${normalizedParent}::${position}`;
}

export function recordMemberIdentity(record: CRecordDefinition, member: CRecordMember): string {
  const memberName = member.name
    ?? `anonymous@${member.range.startPosition.row}:${member.range.startPosition.column}`;
  return `${recordIdentity(record)}::${memberName}`;
}

function isCSourcePath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(".c");
}

function isCHeaderPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(".h");
}

function comparePathAndName(
  left: CFunctionDefinition | CGlobalVariableDeclaration,
  right: CFunctionDefinition | CGlobalVariableDeclaration
): number {
  return left.relativePath.localeCompare(right.relativePath)
    || left.name.localeCompare(right.name);
}
