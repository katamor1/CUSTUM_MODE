const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const extensionRoot = path.resolve(__dirname, "..", "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")

function extensionPath(...segments) {
  return path.join(extensionRoot, ...segments)
}

function repoPath(...segments) {
  return path.join(repoRoot, ...segments)
}

function readExtensionFile(...segments) {
  return fs.readFileSync(extensionPath(...segments), "utf8")
}

function readRepoFile(...segments) {
  return fs.readFileSync(repoPath(...segments), "utf8")
}

function readSrc(...segments) {
  return readExtensionFile("src", ...segments)
}

function readSourceSet(files) {
  return files.map((file) => readSrc(...file.split("/"))).join("\n")
}

function readJson(...segments) {
  return JSON.parse(readExtensionFile(...segments))
}

function assertContributesCommand(packageJson, commandId, options = {}) {
  const { activation = true, palette = true } = options
  const commandIds = packageJson.contributes.commands.map((command) => command.command)
  assert.ok(commandIds.includes(commandId), `${commandId} command contribution`)
  if (activation) {
    assert.ok(packageJson.activationEvents.includes(`onCommand:${commandId}`), `${commandId} activation event`)
  }
  if (palette) {
    const paletteIds = packageJson.contributes.menus.commandPalette.map((entry) => entry.command)
    assert.ok(paletteIds.includes(commandId), `${commandId} command palette contribution`)
  }
}

module.exports = {
  extensionRoot,
  repoRoot,
  extensionPath,
  repoPath,
  readExtensionFile,
  readRepoFile,
  readSrc,
  readSourceSet,
  readJson,
  assertContributesCommand
}
