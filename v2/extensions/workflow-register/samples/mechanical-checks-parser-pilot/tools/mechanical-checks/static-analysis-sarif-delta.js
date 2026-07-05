const fs = require("node:fs")

function result(ruleId, level, message, file, line) {
  return {
    ruleId,
    level,
    message: { text: message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: file },
          region: { startLine: line }
        }
      }
    ]
  }
}

fs.mkdirSync("out/analyzer/baseline", { recursive: true })
fs.mkdirSync("out/analyzer/target", { recursive: true })
fs.writeFileSync("out/analyzer/baseline/result.sarif", JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      results: [
        result("SA001", "error", "Existing null dereference", "src/foo.c", 10)
      ]
    }
  ]
}, null, 2))
fs.writeFileSync("out/analyzer/target/result.sarif", JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      results: [
        result("SA001", "error", "Existing null dereference", "src/foo.c", 10),
        result("SA002", "warning", "New unchecked return value", "src/bar.c", 20),
        result("SA003", "warning", "Known pilot exception", "src/known.c", 30)
      ]
    }
  ]
}, null, 2))
console.log("wrote static analysis SARIF delta fixture")
