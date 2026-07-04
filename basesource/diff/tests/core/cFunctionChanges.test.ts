import { describe, expect, it } from "vitest";
import {
  compareCFunctionDefinitions,
  extractChangedCFunctions
} from "../../src/core/cFunctionChanges";
import { parseCSource } from "../../src/core/cProjectParser";

describe("extractChangedCFunctions", () => {
  it("returns changed, new, and deleted functions for modified C source files", () => {
    const left = `
      static int unchanged_helper(int value)
      {
          return value + 1;
      }

      int changed_function(int value)
      {
          return value + 10;
      }

      int deleted_function(void)
      {
          return 1;
      }
    `;
    const right = `
      static int unchanged_helper(int value)
      {
          return value + 1;
      }

      int changed_function(int value)
      {
          return value + 20;
      }

      int new_function(void)
      {
          return 2;
      }
    `;

    expect(extractChangedCFunctions("src/sample.c", "modified", left, right)).toEqual([
      { name: "changed_function", status: "modified" },
      { name: "deleted_function", status: "deleted" },
      { name: "new_function", status: "added" }
    ]);
  });

  it("marks all functions in added and deleted C source files", () => {
    const source = `
      int first_function(void)
      {
          return 1;
      }

      static int second_function(int value)
      {
          return value;
      }
    `;

    expect(extractChangedCFunctions("src/added.c", "added", undefined, source)).toEqual([
      { name: "first_function", status: "added" },
      { name: "second_function", status: "added" }
    ]);
    expect(extractChangedCFunctions("src/deleted.c", "deleted", source, undefined)).toEqual([
      { name: "first_function", status: "deleted" },
      { name: "second_function", status: "deleted" }
    ]);
  });

  it("ignores C headers and non-C source files", () => {
    expect(extractChangedCFunctions("include/sample.h", "modified", "int x(void);", "int x(void);")).toEqual([]);
    expect(extractChangedCFunctions("src/readme.txt", "modified", "left", "right")).toEqual([]);
  });

  it("compares Tree-sitter function models without treating declaration formatting as a body change", async () => {
    const left = await parseCSource({
      relativePath: "src/sample.c",
      content: `
int kept(int value)
{
  return value;
}
int removed(void) { return 1; }
`
    });
    const right = await parseCSource({
      relativePath: "src/sample.c",
      content: `
int kept(
  int value
) {
  return value;
}
int added(void) { return 2; }
`
    });

    expect(compareCFunctionDefinitions("modified", left.functions, right.functions)).toEqual([
      { name: "removed", status: "deleted" },
      { name: "added", status: "added" }
    ]);
  });
});
