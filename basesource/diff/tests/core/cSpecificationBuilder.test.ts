import { describe, expect, it } from "vitest";
import { parseCProject } from "../../src/core/cProjectParser";
import { diffCSpecifications } from "../../src/core/cSpecificationDiff";
import { buildCSpecifications } from "../../src/core/cSpecificationBuilder";

describe("buildCSpecifications", () => {
  it("assembles function documentation, parameters, callers, and Japanese missing markers", async () => {
    const sources = {
      "$/src/new.c": `
/**
 * @brief 新規処理
 * @param[in] value 入力値
 * @return 処理結果
 * @retval 0 成功
 * @note 注意事項
 */
int added(int value, int undocumented) { return value + undocumented; }
`,
      "$/src/z.c": "int z_caller(void) { return added(1, 2); }",
      "$/src/a.c": "int a_caller(void) { return added(3, 4); }"
    };
    const before = await parseCProject([]);
    const after = await parseCProject(Object.entries(sources).map(([relativePath, content]) => ({
      relativePath,
      content
    })));

    const specifications = await buildCSpecifications({
      project: after,
      diff: diffCSpecifications(before, after),
      sources
    });

    expect(specifications.functions.find((fn) => fn.name === "added")).toEqual({
        name: "added",
        relativePath: "$/src/new.c",
        declaration: "int added(int value, int undocumented)",
        returnType: "int",
        parameters: [
          {
            name: "value",
            declaration: "int value",
            typeName: "int",
            direction: "in",
            description: "入力値"
          },
          {
            name: "undocumented",
            declaration: "int undocumented",
            typeName: "int",
            direction: "記載なし",
            description: "記載なし"
          }
        ],
        brief: "新規処理",
        details: "記載なし",
        returnDescription: "処理結果",
        returnValues: [{ value: "0", description: "成功" }],
        notes: ["注意事項"],
        warnings: ["記載なし"],
        callers: [
          {
            functionId: "$/src/a.c::function::a_caller",
            name: "a_caller",
            relativePath: "$/src/a.c",
            display: "$/src/a.c : a_caller"
          },
          {
            functionId: "$/src/z.c::function::z_caller",
            name: "z_caller",
            relativePath: "$/src/z.c",
            display: "$/src/z.c : z_caller"
          }
        ]
      });
    expect(specifications.functions.find((fn) => fn.name === "a_caller")).toEqual(
      expect.objectContaining({
        name: "a_caller",
        brief: "記載なし",
        details: "記載なし",
        returnDescription: "記載なし",
        notes: ["記載なし"],
        warnings: ["記載なし"],
        callers: []
      })
    );
    expect(specifications.functions.find((fn) => fn.name === "z_caller")).toEqual(
      expect.objectContaining({
        name: "z_caller",
        brief: "記載なし"
      })
    );
  });

  it("marks ambiguous duplicate-name callers instead of assigning them", async () => {
    const sources = {
      "$/src/one.c": "int duplicate(void) { return 1; }",
      "$/src/two.c": "int duplicate(void) { return 2; }",
      "$/src/caller.c": "int caller(void) { return duplicate(); }"
    };
    const after = await parseCProject(Object.entries(sources).map(([relativePath, content]) => ({
      relativePath,
      content
    })));

    const specifications = await buildCSpecifications({
      project: after,
      diff: diffCSpecifications(await parseCProject([]), after),
      sources
    });

    expect(specifications.functions.filter((fn) => fn.name === "duplicate")).toEqual([
      expect.objectContaining({ callers: ["呼び出し先特定不可"] }),
      expect.objectContaining({ callers: ["呼び出し先特定不可"] })
    ]);
  });

  it("includes function pointer table owners in new function callers", async () => {
    const beforeSources = {
      "$/src/table.c": `
struct Entry { int id; int (*handler)(void); };
int existing(void) { return 1; }
int owner(void) {
  static const struct Entry table[] = {
    { 1, existing }
  };
  return 0;
}
`
    };
    const afterSources = {
      "$/src/table.c": `
struct Entry { int id; int (*handler)(void); };
int existing(void) { return 1; }
int added(void) { return 2; }
int owner(void) {
  static const struct Entry table[] = {
    { 1, existing },
    { 2, added }
  };
  return 0;
}
`
    };
    const before = await parseCProject(Object.entries(beforeSources).map(([relativePath, content]) => ({
      relativePath,
      content
    })));
    const after = await parseCProject(Object.entries(afterSources).map(([relativePath, content]) => ({
      relativePath,
      content
    })));

    const specifications = await buildCSpecifications({
      project: after,
      diff: diffCSpecifications(before, after),
      sources: afterSources
    });

    expect(specifications.functions.find((fn) => fn.name === "added")?.callers).toEqual([
      expect.objectContaining({
        name: "owner",
        relativePath: "$/src/table.c",
        display: "$/src/table.c : owner"
      })
    ]);
  });

  it("assembles global variable and record specifications with dimensions, sizes, comments, and declarations", async () => {
    const sources = {
      "$/include/types.h": `
#define COUNT 3
/** 項目型 */
struct Item {
  int id; ///< 識別子
  char name[COUNT];
} item_table[2]; ///< 項目一覧

extern ExternalType unresolved_value;
`
    };
    const after = await parseCProject([{
      relativePath: "$/include/types.h",
      content: sources["$/include/types.h"]
    }]);
    const specifications = await buildCSpecifications({
      project: after,
      diff: diffCSpecifications(await parseCProject([]), after),
      sources
    });

    expect(specifications.globalVariables).toEqual([
      {
        name: "item_table",
        relativePath: "$/include/types.h",
        declaration: expect.stringContaining("item_table[2]"),
        description: "項目一覧",
        typeName: "struct Item",
        arrayDimensions: [2],
        elementCount: 2,
        sizeBytes: 16
      },
      {
        name: "unresolved_value",
        relativePath: "$/include/types.h",
        declaration: "extern ExternalType unresolved_value;",
        description: "記載なし",
        typeName: "ExternalType",
        arrayDimensions: [],
        elementCount: 1,
        sizeBytes: "算出不可"
      }
    ]);
    expect(specifications.records).toEqual([
      {
        kind: "struct",
        name: "Item",
        relativePath: "$/include/types.h",
        description: "項目型",
        status: "new-type",
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
            name: "name",
            declaration: "char name[COUNT];",
            typeName: "char",
            arrayDimensions: [3],
            elementCount: 3,
            sizeBytes: 3,
            description: "記載なし"
          }
        ],
        sizeBytes: 8,
        declaredVariables: [
          expect.objectContaining({
            name: "item_table",
            sizeBytes: 16
          })
        ]
      }
    ]);
  });
});
