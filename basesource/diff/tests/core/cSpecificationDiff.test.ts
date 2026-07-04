import { describe, expect, it } from "vitest";
import { parseCProject } from "../../src/core/cProjectParser";
import {
  diffCSpecifications,
  functionIdentity,
  globalVariableIdentity,
  recordIdentity
} from "../../src/core/cSpecificationDiff";

describe("diffCSpecifications", () => {
  it("finds new functions and variables while excluding modifications and treating moves as additions", async () => {
    const before = await parseCProject([
      {
        relativePath: "src/main.c",
        content: `
int existing(void) { return 1; }
int moved(void) { return 2; }
`
      },
      {
        relativePath: "include/old.h",
        content: `
extern int existing_value;
extern int moved_value;
`
      }
    ]);
    const after = await parseCProject([
      {
        relativePath: "src/main.c",
        content: `
int existing(void) { return 99; }
int added(void) { return 3; }
`
      },
      {
        relativePath: "src/new.c",
        content: "int moved(void) { return 2; }"
      },
      {
        relativePath: "include/old.h",
        content: `
extern long existing_value;
extern int added_value;
`
      },
      {
        relativePath: "include/new.h",
        content: "extern int moved_value;"
      }
    ]);

    const diff = diffCSpecifications(before, after);

    expect(diff.newFunctions.map((fn) => [fn.relativePath, fn.name])).toEqual([
      ["$/src/main.c", "added"],
      ["$/src/new.c", "moved"]
    ]);
    expect(diff.newGlobalVariables.map((variable) => [variable.relativePath, variable.name])).toEqual([
      ["$/include/new.h", "moved_value"],
      ["$/include/old.h", "added_value"]
    ]);
  });

  it("emits all members of new records and only added member names for existing records", async () => {
    const before = await parseCProject([
      {
        relativePath: "include/types.h",
        content: `
struct Existing { int kept; int changed; };
typedef struct { int value; } AnonymousAlias;
`
      }
    ]);
    const after = await parseCProject([
      {
        relativePath: "include/types.h",
        content: `
struct Existing { int kept; long changed; int added; };
typedef struct { int value; } AnonymousAlias;
union Added { int i; double d; };
`
      }
    ]);

    const diff = diffCSpecifications(before, after);

    expect(diff.records).toEqual([
      expect.objectContaining({
        status: "existing-type-new-members",
        record: expect.objectContaining({ kind: "struct", name: "Existing" }),
        members: [
          expect.objectContaining({ name: "added" })
        ]
      }),
      expect.objectContaining({
        status: "new-type",
        record: expect.objectContaining({ kind: "union", name: "Added" }),
        members: [
          expect.objectContaining({ name: "i" }),
          expect.objectContaining({ name: "d" })
        ]
      })
    ]);
  });

  it("treats every supported symbol in a new file as new and distinguishes anonymous records by location", async () => {
    const before = await parseCProject([]);
    const after = await parseCProject([
      {
        relativePath: "src/new.c",
        content: "int created(void) { return 0; }"
      },
      {
        relativePath: "include/new.h",
        content: `
extern int value;
typedef struct { int member; } Alias;
`
      }
    ]);

    const diff = diffCSpecifications(before, after);
    expect(diff.newFunctions.map((fn) => fn.name)).toEqual(["created"]);
    expect(diff.newGlobalVariables.map((variable) => variable.name)).toEqual(["value"]);
    expect(diff.records).toHaveLength(1);
    expect(diff.records[0]).toEqual(expect.objectContaining({
      status: "new-type",
      record: expect.objectContaining({ name: undefined })
    }));

    const anonymous = after.files[0].records[0];
    expect(recordIdentity(anonymous)).toContain("$/include/new.h::anonymous-struct");
  });

  it("detects new multi-word scalar declarations in headers", async () => {
    const before = await parseCProject([{
      relativePath: "include/counter.h",
      content: "#pragma once\n"
    }]);
    const after = await parseCProject([{
      relativePath: "include/counter.h",
      content: "#pragma once\nextern unsigned long processed_count;\n"
    }]);

    expect(diffCSpecifications(before, after).newGlobalVariables).toEqual([
      expect.objectContaining({
        relativePath: "$/include/counter.h",
        name: "processed_count"
      })
    ]);
  });
});

describe("symbol identities", () => {
  it("uses the approved path and type identity rules", async () => {
    const project = await parseCProject([
      { relativePath: "src/sample.c", content: "static int run(void) { return 0; }" },
      { relativePath: "include/sample.h", content: "extern int value; struct Item { int id; };" }
    ]);
    const fn = project.files.find((file) => file.relativePath.endsWith(".c"))?.functions[0];
    const header = project.files.find((file) => file.relativePath.endsWith(".h"));
    if (!fn || !header) {
      throw new Error("Expected parsed C symbols");
    }

    expect(functionIdentity(fn)).toBe("$/src/sample.c::run");
    expect(globalVariableIdentity(header.globalVariables[0])).toBe("$/include/sample.h::value");
    expect(recordIdentity(header.records[0])).toBe("struct::Item");
  });
});
