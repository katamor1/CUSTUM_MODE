import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectCSourceInputs } from "../../src/core/cProjectSources";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("collectCSourceInputs", () => {
  it("collects every C source and header with normalized relative paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "diffrepo-c-project-"));
    tempRoots.push(root);
    await write(root, "src/main.c", "int main(void) { return helper(); }\n");
    await write(root, "include/API.H", "int helper(void);\n");
    await write(root, "notes/readme.md", "# ignored\n");

    await expect(collectCSourceInputs(root)).resolves.toEqual([
      { relativePath: "$/include/API.H", content: "int helper(void);\n" },
      { relativePath: "$/src/main.c", content: "int main(void) { return helper(); }\n" }
    ]);
  });

  it("stops before reading files when aborted", async () => {
    const root = await mkdtemp(join(tmpdir(), "diffrepo-c-project-abort-"));
    tempRoots.push(root);
    await write(root, "sample.c", "int sample(void) { return 0; }\n");
    const controller = new AbortController();
    controller.abort();

    await expect(collectCSourceInputs(root, controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });
  });
});

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
}
