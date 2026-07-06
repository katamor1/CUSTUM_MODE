import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const require = createRequire(import.meta.url);

function treeSitterAssetsPlugin() {
  return {
    name: "copy-tree-sitter-assets",
    closeBundle(): void {
      const targetDirectory = resolve(__dirname, "out/main/tree-sitter-assets");
      mkdirSync(targetDirectory, { recursive: true });
      copyFileSync(
        require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
        resolve(targetDirectory, "tree-sitter.wasm")
      );
      copyFileSync(
        resolve(
          dirname(require.resolve("@cursorless/tree-sitter-wasms/package.json")),
          "out/tree-sitter-c.wasm"
        ),
        resolve(targetDirectory, "tree-sitter-c.wasm")
      );
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), treeSitterAssetsPlugin()],
    build: {
      outDir: "out",
      rollupOptions: {
        input: {
          "main/index": resolve(__dirname, "src/main/index.ts"),
          "worker/index": resolve(__dirname, "src/worker/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts")
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()]
  }
});
