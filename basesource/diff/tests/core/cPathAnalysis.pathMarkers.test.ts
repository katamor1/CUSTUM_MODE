import { describe, expect, it } from "vitest";
import { analyzeCPathChanges } from "../../src/core/cPathAnalysis";

describe("analyzeCPathChanges path line facts", () => {
  it("classifies executable statements and branch conditions", async () => {
    const beforeSource = [
      "int changed(int value)",
      "{",
      "    int total = value + 1;",
      "    if (total > 10) {",
      "        return 10;",
      "    }",
      "    return total;",
      "}"
    ].join("\n");
    const afterSource = [
      "int changed(int value)",
      "{",
      "    int total = value + 2;",
      "    if (total > 20) {",
      "        return 10;",
      "    }",
      "    return total;",
      "}"
    ].join("\n");

    const plan = await analyzeCPathChanges({ status: "modified", beforeSource, afterSource });
    const fn = plan.functions[0];

    expect(fn.name).toBe("changed");
    expect(plan.afterLineFacts.get(1)).toMatchObject({ kind: "declaration" });
    expect(plan.afterLineFacts.get(2)).toMatchObject({ kind: "brace" });
    expect(plan.afterLineFacts.get(3)).toMatchObject({
      kind: "executable",
      normalizedCode: "int total = value + 2;"
    });
    expect(plan.afterLineFacts.get(4)).toMatchObject({
      kind: "branch",
      normalizedCode: "if (total > 20) {"
    });
  });

  it("does not keep comment-only or whitespace-only function changes", async () => {
    const beforeSource = [
      "int comment_only(int value)",
      "{",
      "    // before",
      "    return value;",
      "}",
      "",
      "int whitespace_only(int value) { return value; }"
    ].join("\n");
    const afterSource = [
      "int comment_only(int value)",
      "{",
      "    // after",
      "    return value;",
      "}",
      "",
      "int whitespace_only(",
      "    int value",
      ")",
      "{",
      "    return value;",
      "}"
    ].join("\n");

    const plan = await analyzeCPathChanges({ status: "modified", beforeSource, afterSource });

    expect(plan.functions).toEqual([]);
    expect(plan.afterLineFacts.get(3)).toMatchObject({ kind: "comment" });
    expect(plan.afterLineFacts.get(6)).toMatchObject({ kind: "blank" });
    expect(plan.afterLineFacts.get(7)).toMatchObject({ kind: "declaration" });
  });

  it("provides explicit marker reasons for added functions", async () => {
    const afterSource = [
      "int added(int value)",
      "{",
      "    if (value > 0) {",
      "        return value;",
      "    } else {",
      "        return 0;",
      "    }",
      "}"
    ].join("\n");

    const plan = await analyzeCPathChanges({ status: "added", afterSource });

    expect(plan.functions[0].newFunctionReviewMarkers).toEqual([
      { afterLine: 2, reason: "function-entry" },
      { afterLine: 3, reason: "added-branch" },
      { afterLine: 5, reason: "added-branch" }
    ]);
  });
});
