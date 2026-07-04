import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { exportChangeListDocument } from "../../src/core/changeListDocument";
import type { CSpecificationModels } from "../../src/core/cSpecificationBuilder";

const tempRoots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("exportChangeListDocument", () => {
  it("writes changed files and indented changed C functions to a Word document", async () => {
    const root = await tempRoot("diffrepo-change-list-");
    const outputPath = join(root, "change-list.docx");

    await exportChangeListDocument({
      outputPath,
      files: [
        {
          relativePath: "ENG/Resource.rc",
          status: "modified",
          isText: true,
          functions: []
        },
        {
          relativePath: "assets/image.bin",
          status: "modified",
          isText: false,
          functions: []
        },
        {
          relativePath: "src/sample.c",
          status: "modified",
          isText: true,
          functions: [
            { name: "changed_function", status: "modified" },
            { name: "new_function", status: "added" },
            { name: "deleted_function", status: "deleted" }
          ]
        },
        {
          relativePath: "src/new_file.c",
          status: "added",
          isText: true,
          functions: [{ name: "new_file_function", status: "added" }]
        },
        {
          relativePath: "src/old_file.c",
          status: "deleted",
          isText: true,
          functions: [{ name: "old_file_function", status: "deleted" }]
        }
      ]
    });

    const contents = await docxContents(outputPath);

    expect(contents.paragraphs).toEqual([
      "変更ファイル一覧",
      "$/ENG/Resource.rc",
      "$/assets/image.bin",
      "$/src/sample.c",
      "\tchanged_function",
      "\t【新規】new_function",
      "\t【削除】deleted_function",
      "【新規】$/src/new_file.c",
      "\t【新規】new_file_function",
      "【削除】$/src/old_file.c",
      "\t【削除】old_file_function",
      "新規関数仕様書",
      "該当なし",
      "新規変数仕様書",
      "該当なし"
    ]);
    expect(contents.headingTexts).toEqual([
      "変更ファイル一覧",
      "新規関数仕様書",
      "新規変数仕様書"
    ]);
  });

  it("writes detailed function, variable, record, and member specification tables", async () => {
    const root = await tempRoot("diffrepo-c-specifications-");
    const outputPath = join(root, "change-list.docx");
    const specifications: CSpecificationModels = {
      functions: [
        {
          name: "calculate_total",
          relativePath: "$/src/calculate.c",
          declaration: "int calculate_total(const int *values, size_t count)",
          returnType: "int",
          parameters: [
            {
              name: "values",
              declaration: "const int *values",
              typeName: "const int *",
              direction: "in",
              description: "加算対象の配列"
            },
            {
              name: "count",
              declaration: "size_t count",
              typeName: "size_t",
              direction: "in",
              description: "配列要素数"
            }
          ],
          brief: "合計値を計算する",
          details: "指定された配列の各要素を加算する。",
          returnDescription: "計算結果を返す。",
          returnValues: [
            { value: "-1", description: "入力が不正" },
            { value: "0以上", description: "計算結果" }
          ],
          notes: ["オーバーフローは呼び出し元で確認する。"],
          warnings: ["values は count 個の要素を参照できること。"],
          callers: [
            {
              functionId: "$/src/main.c::run",
              name: "run",
              relativePath: "$/src/main.c",
              display: "$/src/main.c : run"
            },
            "呼び出し先特定不可"
          ]
        }
      ],
      globalVariables: [
        {
          name: "g_values",
          relativePath: "$/include/sample.h",
          declaration: "extern int g_values[2][3];",
          description: "共有値",
          typeName: "int",
          arrayDimensions: [2, 3],
          elementCount: 6,
          sizeBytes: 24
        }
      ],
      records: [
        {
          kind: "struct",
          name: "SampleRecord",
          relativePath: "$/include/sample.h",
          description: "サンプル構造体",
          status: "new-type",
          sizeBytes: 8,
          declaredVariables: [
            {
              name: "g_sample",
              relativePath: "$/include/sample.h",
              declaration: "extern struct SampleRecord g_sample;",
              description: "共有サンプル",
              typeName: "struct SampleRecord",
              arrayDimensions: [],
              elementCount: 1,
              sizeBytes: 8
            }
          ],
          members: [
            {
              name: "id",
              declaration: "int id;",
              typeName: "int",
              arrayDimensions: [],
              elementCount: 1,
              sizeBytes: 4,
              description: "識別子"
            },
            {
              name: "flags",
              declaration: "unsigned char flags[4];",
              typeName: "unsigned char",
              arrayDimensions: [4],
              elementCount: 4,
              sizeBytes: 4,
              description: "フラグ"
            }
          ]
        },
        {
          kind: "union",
          name: "ExistingValue",
          relativePath: "$/include/existing.h",
          description: "既存共用体",
          status: "existing-type-new-members",
          sizeBytes: "算出不可",
          declaredVariables: [],
          members: [
            {
              name: "raw",
              declaration: "ExternalType raw;",
              typeName: "ExternalType",
              arrayDimensions: ["算出不可"],
              elementCount: "算出不可",
              sizeBytes: "算出不可",
              description: "追加された生値"
            }
          ]
        }
      ]
    };

    await exportChangeListDocument({
      outputPath,
      files: [
        {
          relativePath: "src/calculate.c",
          status: "added",
          isText: true,
          functions: [{ name: "calculate_total", status: "added" }]
        }
      ],
      specifications
    });

    const contents = await docxContents(outputPath);

    expect(contents.headingTexts).toEqual([
      "変更ファイル一覧",
      "新規関数仕様書",
      "関数: calculate_total",
      "新規変数仕様書",
      "新規グローバル変数",
      "変数: g_values",
      "新規構造体・共用体",
      "構造体: SampleRecord",
      "既存構造体・共用体の新規メンバー",
      "共用体: ExistingValue"
    ]);
    expect(contents.tables).toEqual([
      [
        ["関数名", "calculate_total"],
        ["定義ファイル", "$/src/calculate.c"],
        ["宣言", "int calculate_total(const int *values, size_t count)"],
        ["戻り値型", "int"],
        ["概要", "合計値を計算する"],
        ["詳細説明", "指定された配列の各要素を加算する。"],
        ["戻り値説明", "計算結果を返す。"],
        ["注意事項", "オーバーフローは呼び出し元で確認する。"],
        ["警告", "values は count 個の要素を参照できること。"]
      ],
      [
        ["引数名", "引数型", "入出力属性", "引数説明"],
        ["values", "const int *", "in", "加算対象の配列"],
        ["count", "size_t", "in", "配列要素数"]
      ],
      [
        ["@retval", "説明"],
        ["-1", "入力が不正"],
        ["0以上", "計算結果"]
      ],
      [
        ["呼び出し元"],
        ["$/src/main.c : run"],
        ["呼び出し先特定不可"]
      ],
      [
        ["変数名", "g_values"],
        ["宣言ファイル", "$/include/sample.h"],
        ["宣言", "extern int g_values[2][3];"],
        ["変数内容", "共有値"],
        ["型または構造体・共用体名", "int"],
        ["配列数", "[2][3]"],
        ["総要素数", "6"],
        ["サイズ", "24 bytes"]
      ],
      [
        ["種別", "構造体"],
        ["型名", "SampleRecord"],
        ["宣言ファイル", "$/include/sample.h"],
        ["説明", "サンプル構造体"],
        ["全体サイズ", "8 bytes"],
        ["同時宣言された新規グローバル変数", "g_sample"]
      ],
      [
        ["メンバー名", "型", "配列数", "サイズ", "説明"],
        ["id", "int", "なし", "4 bytes", "識別子"],
        ["flags", "unsigned char", "[4]", "4 bytes", "フラグ"]
      ],
      [
        ["種別", "共用体"],
        ["型名", "ExistingValue"],
        ["宣言ファイル", "$/include/existing.h"],
        ["説明", "既存共用体"],
        ["全体サイズ", "算出不可"],
        ["同時宣言された新規グローバル変数", "該当なし"]
      ],
      [
        ["メンバー名", "型", "配列数", "サイズ", "説明"],
        ["raw", "ExternalType", "[算出不可]", "算出不可", "追加された生値"]
      ]
    ]);
    expect(contents.documentXml).toContain("<w:shd");
    expect(contents.documentXml).toContain('w:fill="D9EAF7"');
    expect(contents.documentXml).not.toContain("<w:noWrap");
  });
});

interface DocxContents {
  documentXml: string;
  paragraphs: string[];
  headingTexts: string[];
  tables: string[][][];
}

async function docxContents(filePath: string): Promise<DocxContents> {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const paragraphXmls = Array.from(
    documentXml.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)
  ).map((paragraphMatch) => paragraphMatch[0]);
  const paragraphs = paragraphXmls.map(xmlText);
  const headingTexts = paragraphXmls
    .filter((paragraphXml) => /<w:pStyle w:val="Heading[123]"\/>/.test(paragraphXml))
    .map(xmlText);
  const tables = Array.from(documentXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g))
    .map((tableMatch) => Array.from(tableMatch[0].matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g))
      .map((rowMatch) => Array.from(rowMatch[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g))
        .map((cellMatch) => {
          const cellParagraphs = Array.from(
            cellMatch[0].matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)
          ).map((paragraphMatch) => xmlText(paragraphMatch[0]));
          return cellParagraphs.join("\n");
        })));

  return { documentXml, paragraphs, headingTexts, tables };
}

function xmlText(xml: string): string {
  const normalized = xml.replace(/<w:tab\/>/g, "\t");
  return Array.from(normalized.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((textMatch) => unescapeXml(textMatch[1]))
    .join("");
}

function unescapeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
