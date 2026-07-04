import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProjectCSpecifications } from "../../src/core/cSpecificationProject";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("buildProjectCSpecifications", () => {
  it("uses all after-side C files for callers and type resolution", async () => {
    const before = await tempRoot("diffrepo-c-spec-before-");
    const after = await tempRoot("diffrepo-c-spec-after-");
    await write(before, "src/module.c", "int existing(void) { return 1; }\n");
    await write(after, "src/module.c", `
/** @brief 新規処理
 * @param[in] value 入力値
 * @return 処理結果
 */
int added(int value) { return value; }
int existing(void) { return 1; }
`);
    await write(before, "src/caller.c", "int caller(void) { return added(1); }\n");
    await write(after, "src/caller.c", "int caller(void) { return added(1); }\n");
    await write(after, "include/types.h", `
#ifndef TYPES_H
#define TYPES_H
#define COUNT 3
typedef unsigned long Counter;
struct Item { int id; char name[COUNT]; };
extern struct Item items[2]; ///< 項目一覧
extern Counter processed_count; ///< 処理数
#endif
`);

    const progress: Array<[number, number, string]> = [];
    const specifications = await buildProjectCSpecifications({
      beforeRoot: before,
      afterRoot: after,
      onProgress: (completed, total, relativePath) => progress.push([completed, total, relativePath])
    });

    expect(specifications.functions).toEqual([
      expect.objectContaining({
        name: "added",
        callers: [
          expect.objectContaining({ display: "$/src/caller.c : caller" })
        ]
      })
    ]);
    expect(specifications.globalVariables).toEqual([
      expect.objectContaining({
        name: "items",
        arrayDimensions: [2],
        sizeBytes: 16,
        description: "項目一覧"
      }),
      expect.objectContaining({
        name: "processed_count",
        sizeBytes: 4,
        description: "処理数"
      })
    ]);
    expect(specifications.records).toEqual([
      expect.objectContaining({
        name: "Item",
        sizeBytes: 8
      })
    ]);
    expect(progress.at(-1)?.[0]).toBe(progress.at(-1)?.[1]);
  });

  it("accepts cancellation after entering type and caller resolution", async () => {
    const before = await tempRoot("diffrepo-c-spec-cancel-before-");
    const after = await tempRoot("diffrepo-c-spec-cancel-after-");
    await write(after, "src/new.c", "int added(void) { return 1; }\n");
    const controller = new AbortController();

    await expect(buildProjectCSpecifications({
      beforeRoot: before,
      afterRoot: after,
      signal: controller.signal,
      onResolvingTypes: () => {
        setTimeout(() => controller.abort(), 0);
      }
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
}
