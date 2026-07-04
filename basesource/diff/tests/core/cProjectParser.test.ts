import { describe, expect, it } from "vitest";
import { parseCProject, parseCSource } from "../../src/core/cProjectParser";

describe("parseCSource", () => {
  it("parses C declarations, definitions, calls, macros, and pack directives into serializable models", async () => {
    const parsed = await parseCSource({
      relativePath: "include\\sample.h",
      content: `
#define COUNT (2 + 3)
#define APPLY(x) (x)
#pragma pack(push, 1)
typedef unsigned long DWORD;
typedef struct Item {
  int id;
  char name[COUNT];
  struct Item *next;
  unsigned flags : 3;
} Item;
enum Mode { MODE_A = 1, MODE_B };
union Value { int i; double d; };
extern const int values[2][COUNT], other;

static int helper(int x) { return x; }
int run(const Item *item, int input[]) {
  int (*callback)(int) = helper;
  helper(item->id);
  return callback(input[0]);
}
#pragma pack(pop)
`
    });

    expect(parsed.relativePath).toBe("$/include/sample.h");
    expect(parsed.integerMacros).toEqual([
      expect.objectContaining({ name: "COUNT", expression: "(2 + 3)" })
    ]);
    expect(parsed.packDirectives).toEqual([
      expect.objectContaining({ action: "push", value: 1 }),
      expect.objectContaining({ action: "pop" })
    ]);
    expect(parsed.typedefs.map((item) => [item.name, item.targetType.baseType])).toEqual([
      ["DWORD", "unsigned long"],
      ["Item", "struct Item"]
    ]);
    expect(parsed.enums[0]).toEqual(expect.objectContaining({
      name: "Mode",
      enumerators: [
        { name: "MODE_A", valueExpression: "1" },
        { name: "MODE_B" }
      ]
    }));
    expect(parsed.records.map((record) => [record.kind, record.name])).toEqual([
      ["struct", "Item"],
      ["union", "Value"]
    ]);
    expect(parsed.records[0].members.map((member) => ({
      name: member.name,
      baseType: member.type.baseType,
      pointerDepth: member.type.pointerDepth,
      dimensions: member.type.arrayDimensions,
      bitWidth: member.bitWidthExpression
    }))).toEqual([
      { name: "id", baseType: "int", pointerDepth: 0, dimensions: [], bitWidth: undefined },
      { name: "name", baseType: "char", pointerDepth: 0, dimensions: ["COUNT"], bitWidth: undefined },
      { name: "next", baseType: "struct Item", pointerDepth: 1, dimensions: [], bitWidth: undefined },
      { name: "flags", baseType: "unsigned", pointerDepth: 0, dimensions: [], bitWidth: "3" }
    ]);
    expect(parsed.globalVariables.map((variable) => ({
      name: variable.name,
      baseType: variable.type.baseType,
      dimensions: variable.type.arrayDimensions,
      storageClasses: variable.storageClasses,
      qualifiers: variable.type.qualifiers
    }))).toEqual([
      {
        name: "values",
        baseType: "int",
        dimensions: ["2", "COUNT"],
        storageClasses: ["extern"],
        qualifiers: ["const"]
      },
      {
        name: "other",
        baseType: "int",
        dimensions: [],
        storageClasses: ["extern"],
        qualifiers: ["const"]
      }
    ]);
    expect(parsed.functions.map((fn) => fn.name)).toEqual(["helper", "run"]);
    expect(parsed.functions[1]).toEqual(expect.objectContaining({
      name: "run",
      declaration: "int run(const Item *item, int input[])",
      returnType: expect.objectContaining({ baseType: "int", pointerDepth: 0 }),
      localVariableNames: ["callback"],
      calls: [
        expect.objectContaining({ callee: "helper" }),
        expect.objectContaining({ callee: "callback" })
      ]
    }));
    expect(parsed.functions[1].parameters).toEqual([
      expect.objectContaining({
        name: "item",
        type: expect.objectContaining({ baseType: "Item", pointerDepth: 1 })
      }),
      expect.objectContaining({
        name: "input",
        type: expect.objectContaining({ baseType: "int", arrayDimensions: [""] })
      })
    ]);
    expect(parsed.comments).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
    expect(() => JSON.stringify(parsed)).not.toThrow();
  });

  it("keeps parseable declarations and reports syntax diagnostics", async () => {
    const parsed = await parseCSource({
      relativePath: "src/broken.c",
      content: `
int valid(void) { return 1; }
int broken( {
`
    });

    expect(parsed.functions.map((fn) => fn.name)).toContain("valid");
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.diagnostics[0]).toEqual(expect.objectContaining({
      relativePath: "$/src/broken.c"
    }));
  });

  it("parses guarded top-level declarations without treating function-local records as globals", async () => {
    const parsed = await parseCSource({
      relativePath: "include/guarded.h",
      content: `
#ifndef GUARDED_H
#define GUARDED_H
typedef unsigned long Counter;
extern Counter processed_count;
struct PublicItem { int id; };
static int helper(void) {
  struct LocalItem { int value; };
  return 0;
}
#endif
`
    });

    expect(parsed.typedefs.map((item) => item.name)).toEqual(["Counter"]);
    expect(parsed.globalVariables.map((item) => item.name)).toEqual(["processed_count"]);
    expect(parsed.functions.map((item) => item.name)).toEqual(["helper"]);
    expect(parsed.records.map((item) => item.name)).toEqual(["PublicItem"]);
  });

  it("captures function-local static const pointer table references", async () => {
    const parsed = await parseCSource({
      relativePath: "src/table.c",
      content: `
int added(void) { return 0; }
struct Entry { int id; int (*handler)(void); };
int owner(void) {
  static const struct Entry table[] = {
    { 1, added },
    { 2, &added },
    { .id = 3, .handler = added }
  };
  return 0;
}
int single_pointer(void) {
  int (*callback)(void) = added;
  return callback();
}
`
    });

    const owner = parsed.functions.find((fn) => fn.name === "owner");
    const singlePointer = parsed.functions.find((fn) => fn.name === "single_pointer");

    expect(owner?.functionPointerTableReferences.map((reference) => ({
      callee: reference.callee,
      tableName: reference.tableName
    }))).toEqual([
      { callee: "added", tableName: "table" },
      { callee: "added", tableName: "table" },
      { callee: "added", tableName: "table" }
    ]);
    expect(singlePointer?.functionPointerTableReferences).toEqual([]);
  });

  it("captures function-local const pointer array declarators", async () => {
    const parsed = await parseCSource({
      relativePath: "src/const-pointer-table.c",
      content: `
int added(void) { return 0; }
int owner(void) {
  int (* const table[])(void) = { added };
  return 0;
}
`
    });

    const owner = parsed.functions.find((fn) => fn.name === "owner");

    expect(owner?.functionPointerTableReferences.map((reference) => ({
      callee: reference.callee,
      tableName: reference.tableName
    }))).toEqual([
      { callee: "added", tableName: "table" }
    ]);
  });

  it("does not collect subscript designators as function pointer table references", async () => {
    const parsed = await parseCSource({
      relativePath: "src/subscript-designator-table.c",
      content: `
#define ADDED_INDEX 0
int added(void) { return 0; }
struct Entry { int (*handler)(void); };
int owner(void) {
  static const struct Entry table[] = {
    [ADDED_INDEX] = { .handler = added }
  };
  return 0;
}
`
    });

    const owner = parsed.functions.find((fn) => fn.name === "owner");

    expect(owner?.functionPointerTableReferences.map((reference) => ({
      callee: reference.callee,
      tableName: reference.tableName
    }))).toEqual([
      { callee: "added", tableName: "table" }
    ]);
  });
});

describe("parseCProject", () => {
  it("parses multiple files in stable path order", async () => {
    const project = await parseCProject([
      { relativePath: "src\\z.c", content: "int z(void) { return 0; }" },
      { relativePath: "./include/a.h", content: "extern int value;" }
    ]);

    expect(project.files.map((file) => file.relativePath)).toEqual([
      "$/include/a.h",
      "$/src/z.c"
    ]);
    expect(project.diagnostics).toEqual([]);
    expect(JSON.parse(JSON.stringify(project))).toEqual(project);
  });
});
