const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { repoPath, readJson } = require("./helpers/sourceReader")

const expectedCategory = "Bob Workflow"

function commandPaletteCommands(packageJson) {
  const paletteIds = new Set(packageJson.contributes.menus.commandPalette.map((entry) => entry.command))
  return packageJson.contributes.commands.filter((command) => paletteIds.has(command.command))
}

test("Command Palette display names use English Bob category before the colon", () => {
  const packageJson = readJson("package.json")
  const commands = commandPaletteCommands(packageJson)
  assert.ok(commands.length > 0, "commandPalette must expose commands")

  for (const command of commands) {
    assert.equal(command.category, expectedCategory, `${command.command} category`)
    assert.doesNotMatch(command.title, /[:：]/, `${command.command} title must not duplicate the Command Palette category`)

    const displayName = `${command.category}: ${command.title}`
    const prefix = displayName.slice(0, displayName.indexOf(":"))
    assert.ok(displayName.startsWith("Bob "), `${command.command} display name must start with Bob`)
    assert.match(prefix, /^Bob [A-Za-z0-9 &/-]+$/, `${command.command} prefix before colon must be English`)
  }
})

test("extensions README documents the Command Palette display-name policy", () => {
  const readme = fs.readFileSync(path.join(repoPath("extensions"), "README.md"), "utf8")

  for (const phrase of [
    "Command Palette 表示名ポリシー",
    "`Bob <English area>: <日本語の操作名>`",
    "`category`",
    "`title`",
    "コロンの手前"
  ]) {
    assert.ok(readme.includes(phrase), `extensions README must document: ${phrase}`)
  }
})
