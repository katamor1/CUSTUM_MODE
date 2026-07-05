import * as fs from "node:fs"
import * as path from "node:path"

export const EXTENSION_NAME = "bob-bazaar-review"
export const EXTENSION_VERSION = readPackageVersion()

function readPackageVersion(): string {
  let current = __dirname
  for (let depth = 0; depth < 5; depth += 1) {
    const packageJsonPath = path.join(current, "package.json")
    if (fs.existsSync(packageJsonPath)) {
      const value = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown }
      if (typeof value.version === "string" && value.version.trim()) return value.version
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return "0.0.0"
}
