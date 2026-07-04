import { describe, expect, it } from "vitest";
import { analyzeCPathChanges } from "../../src/core/cPathAnalysis";

describe("analyzeCPathChanges", () => {
  it("keeps changed existing and added functions while excluding non-path changes", async () => {
    const beforeSource = `
#define LIMIT 3
#pragma pack(push, 1)
int global_value = 1;

int changed_existing(int value)
{
    return value + 1;
}

int deleted_function(void)
{
    return 9;
}

int comment_only(int value)
{
    /* old explanation */
    return value;
}

int whitespace_only(int value) { return value; }
#pragma pack(pop)
`;
    const afterSource = `
#define LIMIT 4
#pragma pack(push, 2)
int global_value = 2;

int changed_existing(int value)
{
    return value + 2;
}

int comment_only(int value)
{
    /******** new explanation ********/
    return value;
}

int whitespace_only(
    int value
)
{
    return value;
}

int new_function(int value)
{
    return value * 2;
}
#pragma pack(pop)
`;

    const result = await analyzeCPathChanges({
      status: "modified",
      beforeSource,
      afterSource
    });

    expect(result.functions.map((fn) => ({
      name: fn.name,
      status: fn.status
    }))).toEqual([
      { name: "changed_existing", status: "modified" },
      { name: "new_function", status: "added" }
    ]);
    expect(result.functions[0]).toEqual(expect.objectContaining({
      beforeRange: expect.objectContaining({ startLine: 6, endLine: 9 }),
      afterRange: expect.objectContaining({ startLine: 6, endLine: 9 }),
      afterBodyStartLine: 7
    }));
  });

  it("marks the body entry and each branch or loop entry in an added function", async () => {
    const afterSource = [
      "int new_paths(int value)",
      "{",
      "    if (value > 10) {",
      "        value += 1;",
      "    } else if (value > 5) {",
      "        value += 2;",
      "    } else {",
      "        value -= 1;",
      "    }",
      "    if (value != 0) {",
      "        if (value < 0) {",
      "            value = -value;",
      "        }",
      "    }",
      "    switch (value) {",
      "    case 1:",
      "        break;",
      "    case 2:",
      "        value += 2;",
      "        break;",
      "    default:",
      "        value = 0;",
      "        break;",
      "    }",
      "    for (int index = 0; index < 2; index++) {",
      "        continue;",
      "    }",
      "    while (value < 3) {",
      "        value++;",
      "    }",
      "    do {",
      "        value--;",
      "    } while (value > 1);",
      "    value = value > 0 ? value : 0;",
      "    // if (comment_only) {",
      "    return value;",
      "}"
    ].join("\n");

    const result = await analyzeCPathChanges({
      status: "added",
      afterSource
    });

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].status).toBe("added");
    expect([...result.functions[0].newFunctionMarkerLines]).toEqual([
      2,
      3,
      5,
      7,
      10,
      11,
      15,
      16,
      18,
      21,
      25,
      28,
      31,
      34
    ]);
    expect(result.functions[0].commentLines).toContain(35);
    expect(result.functions[0].newFunctionMarkerLines.has(35)).toBe(false);
  });

  it("returns no functions for deleted files and no analysis for headers", async () => {
    const deleted = await analyzeCPathChanges({
      status: "deleted",
      beforeSource: "int removed(void) { return 1; }"
    });
    const header = await analyzeCPathChanges({
      status: "modified",
      relativePath: "include/sample.h",
      beforeSource: "#define VALUE 1",
      afterSource: "#define VALUE 2"
    });

    expect(deleted.functions).toEqual([]);
    expect(header.functions).toEqual([]);
  });
});
