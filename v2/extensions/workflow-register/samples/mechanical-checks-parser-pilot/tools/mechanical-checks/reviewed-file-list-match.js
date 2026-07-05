const fs = require("node:fs")

fs.mkdirSync("out/review", { recursive: true })
fs.writeFileSync("out/review/mismatch.csv", [
  "id,file,line,message,severity",
  "REV001,src/review-target.c,1,\"Committed file is missing from reviewed file list\",error"
].join("\n"))
console.log("wrote reviewed file list mismatch fixture")
