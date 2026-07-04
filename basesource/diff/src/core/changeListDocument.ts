import { writeFile } from "node:fs/promises";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import type { CFunctionChange } from "./cFunctionChanges";
import type {
  CSpecificationModels,
  NewFunctionSpecification,
  NewGlobalVariableSpecification,
  NewRecordSpecification,
  RecordMemberSpecification
} from "./cSpecificationBuilder";
import type { CLayoutValue } from "./cTypeLayout";
import type { FilePairStatus } from "./types";

const NONE = "該当なし";
const TABLE_WIDTH = 9_600;
const HEADER_FILL = "D9EAF7";

export interface ChangeListFile {
  relativePath: string;
  status: FilePairStatus;
  isText: boolean;
  functions: CFunctionChange[];
}

export interface ExportChangeListDocumentInput {
  outputPath: string;
  files: ChangeListFile[];
  specifications?: CSpecificationModels;
  signal?: AbortSignal;
}

export async function exportChangeListDocument(input: ExportChangeListDocumentInput): Promise<void> {
  input.signal?.throwIfAborted();
  const specifications = input.specifications ?? {
    functions: [],
    globalVariables: [],
    records: []
  };
  const children = [
    heading("変更ファイル一覧", HeadingLevel.HEADING_1),
    ...input.files.flatMap((file) => [
      paragraph(fileLine(file)),
      ...file.functions.map((functionChange) => paragraph(`\t${functionLine(functionChange)}`))
    ]),
    heading("新規関数仕様書", HeadingLevel.HEADING_1),
    ...functionSpecificationChildren(specifications.functions),
    heading("新規変数仕様書", HeadingLevel.HEADING_1),
    ...variableSpecificationChildren(specifications)
  ];

  const document = new Document({
    creator: "DiffRepo Report Builder",
    title: "変更ファイル一覧",
    sections: [
      {
        properties: {},
        children
      }
    ],
    styles: {
      default: {
        document: {
          run: {
            font: "Yu Gothic",
            size: 20
          },
          paragraph: {
            spacing: { after: 80 }
          }
        }
      }
    }
  });

  const buffer = await Packer.toBuffer(document);
  input.signal?.throwIfAborted();
  await writeFile(input.outputPath, buffer);
  input.signal?.throwIfAborted();
}

function functionSpecificationChildren(
  functions: NewFunctionSpecification[]
): Array<Paragraph | Table> {
  if (functions.length === 0) {
    return [paragraph(NONE)];
  }

  return functions.flatMap((specification) => [
    heading(`関数: ${specification.name}`, HeadingLevel.HEADING_2),
    detailTable([
      ["関数名", specification.name],
      ["定義ファイル", specificationPath(specification.relativePath)],
      ["宣言", specification.declaration],
      ["戻り値型", specification.returnType],
      ["概要", specification.brief],
      ["詳細説明", specification.details],
      ["戻り値説明", specification.returnDescription],
      ["注意事項", specification.notes],
      ["警告", specification.warnings]
    ]),
    dataTable(
      ["引数名", "引数型", "入出力属性", "引数説明"],
      specification.parameters.map((parameter) => [
        parameter.name,
        parameter.typeName,
        parameter.direction,
        parameter.description
      ])
    ),
    dataTable(
      ["@retval", "説明"],
      specification.returnValues.map((returnValue) => [
        returnValue.value,
        returnValue.description
      ])
    ),
    dataTable(
      ["呼び出し元"],
      specification.callers.map((caller) => [
        typeof caller === "string"
          ? caller
          : `${specificationPath(caller.relativePath)} : ${caller.name}`
      ])
    )
  ]);
}

function variableSpecificationChildren(
  specifications: CSpecificationModels
): Array<Paragraph | Table> {
  if (specifications.globalVariables.length === 0 && specifications.records.length === 0) {
    return [paragraph(NONE)];
  }

  const newRecords = specifications.records.filter((record) => record.status === "new-type");
  const extendedRecords = specifications.records.filter(
    (record) => record.status === "existing-type-new-members"
  );

  return [
    ...globalVariableChildren(specifications.globalVariables),
    ...recordGroupChildren("新規構造体・共用体", newRecords),
    ...recordGroupChildren("既存構造体・共用体の新規メンバー", extendedRecords)
  ];
}

function globalVariableChildren(
  variables: NewGlobalVariableSpecification[]
): Array<Paragraph | Table> {
  if (variables.length === 0) {
    return [];
  }

  return [
    heading("新規グローバル変数", HeadingLevel.HEADING_2),
    ...variables.flatMap((variable) => [
      heading(`変数: ${variable.name}`, HeadingLevel.HEADING_3),
      globalVariableTable(variable)
    ])
  ];
}

function globalVariableTable(variable: NewGlobalVariableSpecification): Table {
  return detailTable([
    ["変数名", variable.name],
    ["宣言ファイル", specificationPath(variable.relativePath)],
    ["宣言", variable.declaration],
    ["変数内容", variable.description],
    ["型または構造体・共用体名", variable.typeName],
    ["配列数", formatArrayDimensions(variable.arrayDimensions)],
    ["総要素数", formatLayoutValue(variable.elementCount)],
    ["サイズ", formatSize(variable.sizeBytes)]
  ]);
}

function recordGroupChildren(
  title: string,
  records: NewRecordSpecification[]
): Array<Paragraph | Table> {
  if (records.length === 0) {
    return [];
  }

  return [
    heading(title, HeadingLevel.HEADING_2),
    ...records.flatMap((record) => [
      heading(`${recordKindLabel(record.kind)}: ${record.name}`, HeadingLevel.HEADING_3),
      recordTable(record),
      memberTable(record.members)
    ])
  ];
}

function recordTable(record: NewRecordSpecification): Table {
  return detailTable([
    ["種別", recordKindLabel(record.kind)],
    ["型名", record.name],
    ["宣言ファイル", specificationPath(record.relativePath)],
    ["説明", record.description],
    ["全体サイズ", formatSize(record.sizeBytes)],
    [
      "同時宣言された新規グローバル変数",
      record.declaredVariables.length > 0
        ? record.declaredVariables.map((variable) => variable.name)
        : NONE
    ]
  ]);
}

function memberTable(members: RecordMemberSpecification[]): Table {
  return dataTable(
    ["メンバー名", "型", "配列数", "サイズ", "説明"],
    members.map((member) => [
      member.name,
      member.typeName,
      formatArrayDimensions(member.arrayDimensions),
      formatSize(member.sizeBytes),
      member.description
    ])
  );
}

function detailTable(rows: Array<[string, string | string[]]>): Table {
  const labelWidth = 3_000;
  const valueWidth = TABLE_WIDTH - labelWidth;
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [labelWidth, valueWidth],
    layout: TableLayoutType.FIXED,
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        tableCell(label, labelWidth, true),
        tableCell(value, valueWidth)
      ]
    }))
  });
}

function dataTable(headers: string[], rows: string[][]): Table {
  const columnWidth = Math.floor(TABLE_WIDTH / headers.length);
  const columnWidths = headers.map((_, index) => (
    index === headers.length - 1
      ? TABLE_WIDTH - columnWidth * (headers.length - 1)
      : columnWidth
  ));
  const bodyRows = rows.length > 0
    ? rows
    : [[NONE, ...headers.slice(1).map(() => "")]];

  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((header, index) => tableCell(header, columnWidths[index], true))
      }),
      ...bodyRows.map((row) => new TableRow({
        children: headers.map((_, index) => tableCell(row[index] ?? "", columnWidths[index]))
      }))
    ]
  });
}

function tableCell(
  value: string | string[],
  width: number,
  isHeader = false
): TableCell {
  const lines = Array.isArray(value) ? value : [value];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: isHeader
      ? { type: ShadingType.CLEAR, fill: HEADER_FILL, color: "auto" }
      : undefined,
    children: lines.map((line) => new Paragraph({
      children: [new TextRun({ text: line, bold: isHeader })],
      spacing: { after: 0 }
    }))
  });
}

function heading(
  text: string,
  level: typeof HeadingLevel[keyof typeof HeadingLevel]
): Paragraph {
  return new Paragraph({
    heading: level,
    children: [new TextRun({ text })],
    spacing: { after: 160 }
  });
}

function paragraph(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text })],
    spacing: { after: 40 }
  });
}

function specificationPath(relativePath: string): string {
  const normalized = relativePath
    .replaceAll("\\", "/")
    .replace(/^\$\/+/, "")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  return `$/${normalized}`;
}

function formatArrayDimensions(dimensions: CLayoutValue[]): string {
  if (dimensions.length === 0) {
    return "なし";
  }

  return dimensions.map((dimension) => `[${formatLayoutValue(dimension)}]`).join("");
}

function formatLayoutValue(value: CLayoutValue): string {
  return typeof value === "number" ? String(value) : value;
}

function formatSize(value: CLayoutValue): string {
  return typeof value === "number" ? `${value} bytes` : value;
}

function recordKindLabel(kind: NewRecordSpecification["kind"]): string {
  return kind === "struct" ? "構造体" : "共用体";
}

function fileLine(file: ChangeListFile): string {
  return `${statusPrefix(file.status)}$/${file.relativePath.replaceAll("\\", "/")}`;
}

function functionLine(functionChange: CFunctionChange): string {
  return `${statusPrefix(functionChange.status)}${functionChange.name}`;
}

function statusPrefix(status: FilePairStatus | CFunctionChange["status"]): string {
  if (status === "added") {
    return "【新規】";
  }

  if (status === "deleted") {
    return "【削除】";
  }

  return "";
}
