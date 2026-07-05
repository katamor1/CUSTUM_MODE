const fs = require("node:fs")

fs.mkdirSync("out/build/baseline", { recursive: true })
fs.mkdirSync("out/build/target", { recursive: true })
fs.writeFileSync("out/build/baseline/build.log", [
  "compile started",
  "warning W001 existing baseline issue",
  "compile finished"
].join("\n"))
fs.writeFileSync("out/build/target/build.log", [
  "compile started",
  "warning W001 existing baseline issue",
  "warning W002 new target issue",
  "compile finished"
].join("\n"))
console.log("wrote build warning delta fixture")
