import { describe, expect, it } from "vitest";
import {
  buildCProjectIndex,
  getDirectCallers
} from "../../src/core/cProjectIndex";
import { parseCProject } from "../../src/core/cProjectParser";

describe("buildCProjectIndex", () => {
  it("indexes direct callers once per function and sorts their display paths", async () => {
    const project = await parseCProject([
      {
        relativePath: "src/target.c",
        content: "int target(void) { return 0; }"
      },
      {
        relativePath: "src/z.c",
        content: "int z_caller(void) { target(); target(); return 0; }"
      },
      {
        relativePath: "src/a.c",
        content: "int a_caller(void) { return target(); }"
      }
    ]);

    const index = await buildCProjectIndex(project);
    const target = project.files[1].functions[0];

    expect(getDirectCallers(index, target)).toEqual([
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
    ]);
    expect(index.ambiguousCalls).toEqual([]);
  });

  it("ignores calls outside functions, function pointers, local shadows, and macro invocations", async () => {
    const project = await parseCProject([
      {
        relativePath: "src/target.c",
        content: "int target(void) { return 0; }"
      },
      {
        relativePath: "src/caller.c",
        content: `
#define INVOKE(name) name()
int initialized = target();
int callback_caller(int (*target)(void)) { return target(); }
int local_shadow(void) {
  int (*target)(void) = 0;
  return target();
}
int initialized_pointer(void) {
  int (*callback)(void) = target;
  return callback();
}
int macro_caller(void) { return INVOKE(target); }
`
      }
    ]);

    const index = await buildCProjectIndex(project);
    const target = project.files.find((file) => file.relativePath === "$/src/target.c")?.functions[0];
    if (!target) {
      throw new Error("Expected target function");
    }

    expect(getDirectCallers(index, target)).toEqual([]);
    expect(index.ambiguousCalls).toEqual([]);
  });

  it("resolves duplicate static names to the definition in the caller file", async () => {
    const project = await parseCProject([
      {
        relativePath: "src/a.c",
        content: `
static int helper(void) { return 1; }
int caller_a(void) { return helper(); }
`
      },
      {
        relativePath: "src/b.c",
        content: `
static int helper(void) { return 2; }
int caller_b(void) { return helper(); }
`
      }
    ]);

    const index = await buildCProjectIndex(project);
    const helperA = project.files[0].functions.find((fn) => fn.name === "helper");
    const helperB = project.files[1].functions.find((fn) => fn.name === "helper");
    if (!helperA || !helperB) {
      throw new Error("Expected both static helpers");
    }

    expect(getDirectCallers(index, helperA).map((caller) => caller.display)).toEqual([
      "$/src/a.c : caller_a"
    ]);
    expect(getDirectCallers(index, helperB).map((caller) => caller.display)).toEqual([
      "$/src/b.c : caller_b"
    ]);
  });

  it("indexes function-local static const pointer table entries as callers", async () => {
    const project = await parseCProject([{
      relativePath: "src/table.c",
      content: `
static int added(void) { return 0; }
struct Entry { int id; int (*handler)(void); };
int owner(void) {
  static const struct Entry table[] = {
    { 1, added },
    { 2, &added },
    { .id = 3, .handler = added }
  };
  return 0;
}
`
    }]);

    const index = await buildCProjectIndex(project);
    const added = project.files[0].functions.find((fn) => fn.name === "added");
    if (!added) {
      throw new Error("Expected added function");
    }

    expect(getDirectCallers(index, added).map((caller) => caller.display)).toEqual([
      "$/src/table.c : owner"
    ]);
    expect(index.ambiguousCalls).toEqual([]);
  });

  it("marks duplicate global targets as ambiguous without assigning either candidate", async () => {
    const project = await parseCProject([
      {
        relativePath: "src/one.c",
        content: "int duplicate(void) { return 1; }"
      },
      {
        relativePath: "src/two.c",
        content: "int duplicate(void) { return 2; }"
      },
      {
        relativePath: "src/caller.c",
        content: "int caller(void) { return duplicate(); }"
      }
    ]);

    const index = await buildCProjectIndex(project);
    const candidates = project.files
      .flatMap((file) => file.functions)
      .filter((fn) => fn.name === "duplicate");

    expect(candidates).toHaveLength(2);
    expect(candidates.flatMap((candidate) => getDirectCallers(index, candidate))).toEqual([]);
    expect(index.ambiguousCalls).toEqual([
      {
        callee: "duplicate",
        caller: {
          functionId: "$/src/caller.c::function::caller",
          name: "caller",
          relativePath: "$/src/caller.c",
          display: "$/src/caller.c : caller"
        },
        candidateFunctionIds: [
          "$/src/one.c::function::duplicate",
          "$/src/two.c::function::duplicate"
        ],
        marker: "呼び出し先特定不可"
      }
    ]);
  });

  it("cooperatively stops caller resolution when aborted", async () => {
    const project = await parseCProject([{
      relativePath: "src/many.c",
      content: Array.from(
        { length: 200 },
        (_, index) => `int function_${index}(void) { return function_0(); }`
      ).join("\n")
    }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);

    await expect(buildCProjectIndex(project, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});
