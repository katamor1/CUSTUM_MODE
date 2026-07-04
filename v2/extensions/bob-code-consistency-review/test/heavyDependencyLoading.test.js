const assert = require("node:assert/strict")
const { test } = require("node:test")

const { readSrc } = require("./helpers/sourceReader")

test("document extraction dependencies are loaded lazily instead of during extension activation", () => {
  const heavyModules = ["mammoth", "read-excel-file", "cheerio"]
  const sources = [
    ["analyzers/documentExtractor.ts", readSrc("analyzers", "documentExtractor.ts")],
    ["analyzers/documentDocxExtractor.ts", readSrc("analyzers", "documentDocxExtractor.ts")],
    ["analyzers/documentXlsxExtractor.ts", readSrc("analyzers", "documentXlsxExtractor.ts")],
    ["core/reviewInputDiscovery.ts", readSrc("core", "reviewInputDiscovery.ts")]
  ]

  for (const [sourcePath, source] of sources) {
    for (const moduleName of heavyModules) {
      const staticImport = new RegExp(`^\\s*import\\s+.*\\s+from\\s+["']${moduleName}["']`, "m")
      const staticRequire = new RegExp(`require\\(["']${moduleName}["']\\)`)
      assert.doesNotMatch(source, staticImport, `${sourcePath} must not statically import ${moduleName}`)
      assert.doesNotMatch(source, staticRequire, `${sourcePath} must not statically require ${moduleName}`)
    }
  }

  assert.match(readSrc("analyzers", "documentDocxExtractor.ts"), /import\("mammoth"\)/)
  assert.match(readSrc("analyzers", "documentDocxExtractor.ts"), /import\("cheerio"\)/)
  assert.match(readSrc("analyzers", "documentXlsxExtractor.ts"), /import\("read-excel-file\/node"\)/)
  assert.match(readSrc("core", "reviewInputDiscovery.ts"), /import\("read-excel-file\/node"\)/)

  const combinedSource = sources.map(([, source]) => source).join("\n")
  assert.doesNotMatch(combinedSource, /import\("xlsx"\)|from\s+["']xlsx["']|require\(["']xlsx["']\)/)
})
