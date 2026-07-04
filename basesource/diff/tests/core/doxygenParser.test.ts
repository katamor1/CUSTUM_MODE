import { describe, expect, it } from "vitest";
import { parseCSource } from "../../src/core/cProjectParser";
import {
  associateDoxygenComments,
  parseDoxygenCommentGroup
} from "../../src/core/doxygenParser";

describe("parseDoxygenCommentGroup", () => {
  it("parses required tags, multiline text, directions, and unmatched parameters", () => {
    const documentation = parseDoxygenCommentGroup([
      {
        text: `/**
 * Free-form details.
 * @brief Runs the operation
 *   across lines.
 * @details Detailed behavior
 *   continues here.
 * @param[in,out] value Updated value
 *   with more detail.
 * @param missing Undeclared parameter.
 * @return Result status.
 * @retval 0 Success.
 * @retval -1 Failure.
 * @note First note.
 * @warning First warning.
 */`,
        style: "block",
        relativePath: "$/src/sample.c",
        range: {
          startIndex: 0,
          endIndex: 1,
          startPosition: { row: 0, column: 0 },
          endPosition: { row: 0, column: 1 }
        }
      }
    ], { parameterNames: ["value"] });

    expect(documentation).toEqual({
      brief: "Runs the operation across lines.",
      details: "Free-form details.\nDetailed behavior continues here.",
      parameters: [
        {
          name: "value",
          direction: "in,out",
          description: "Updated value with more detail."
        },
        {
          name: "missing",
          description: "Undeclared parameter."
        }
      ],
      unmatchedParameters: [
        {
          name: "missing",
          description: "Undeclared parameter."
        }
      ],
      returnDescription: "Result status.",
      returnValues: [
        { value: "0", description: "Success." },
        { value: "-1", description: "Failure." }
      ],
      notes: ["First note."],
      warnings: ["First warning."],
      unparsedTags: []
    });
  });

  it("keeps missing fields absent instead of inserting presentation text", () => {
    expect(parseDoxygenCommentGroup([])).toEqual({
      parameters: [],
      unmatchedParameters: [],
      returnValues: [],
      notes: [],
      warnings: [],
      unparsedTags: []
    });
  });
});

describe("associateDoxygenComments", () => {
  it("associates adjacent groups across blank lines and removes separator-only comments", async () => {
    const source = `
/** First detail. */

/**********************/
// Second detail.

int target(void) { return 0; }
`;
    const parsed = await parseCSource({ relativePath: "src/target.c", content: source });
    const association = associateDoxygenComments(
      source,
      parsed.comments,
      parsed.functions[0].range
    );

    expect(association.leadingComments).toHaveLength(3);
    expect(association.documentation?.details).toBe("First detail.\nSecond detail.");
  });

  it("stops association when code, a preprocessor directive, or another declaration intervenes", async () => {
    const source = `
/** Old function. */
int old_function(void) { return 0; }

/** Before define. */
#define FLAG 1

/** Current function. */
int current_function(void) { return FLAG; }
`;
    const parsed = await parseCSource({ relativePath: "src/target.c", content: source });
    const current = parsed.functions.find((fn) => fn.name === "current_function");
    if (!current) {
      throw new Error("current_function was not parsed");
    }

    const association = associateDoxygenComments(source, parsed.comments, current.range);
    expect(association.leadingComments.map((comment) => comment.text)).toEqual([
      "/** Current function. */"
    ]);
    expect(association.documentation?.details).toBe("Current function.");
  });

  it("returns trailing comments separately so callers can give them priority", async () => {
    const source = `
/** Leading variable detail. */
extern int value; ///< Trailing variable detail.
`;
    const parsed = await parseCSource({ relativePath: "include/value.h", content: source });
    const variable = parsed.globalVariables[0];
    const association = associateDoxygenComments(
      source,
      parsed.comments,
      variable.declarationRange
    );

    expect(association.documentation?.details).toBe("Leading variable detail.");
    expect(association.trailingDescription).toBe("Trailing variable detail.");
  });
});
