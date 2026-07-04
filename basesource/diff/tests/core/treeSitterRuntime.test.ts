import { describe, expect, it } from "vitest";
import { createCParser, resolveTreeSitterAssetPaths } from "../../src/core/treeSitterRuntime";

describe("treeSitterRuntime", () => {
  it("loads the packaged WASM runtime and C grammar", async () => {
    const assetPaths = resolveTreeSitterAssetPaths();
    expect(assetPaths.runtimeWasmPath).toMatch(/(?:web-)?tree-sitter\.wasm$/);
    expect(assetPaths.cGrammarWasmPath).toMatch(/tree-sitter-c\.wasm$/);

    const parser = await createCParser();
    const tree = parser.parse("int f(void) { return 0; }");
    if (!tree) {
      throw new Error("Tree-sitter returned no syntax tree");
    }

    expect(tree.rootNode.type).toBe("translation_unit");
    expect(tree.rootNode.namedChild(0)?.type).toBe("function_definition");
  });
});
