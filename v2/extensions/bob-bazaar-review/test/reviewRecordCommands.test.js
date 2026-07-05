const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { extensionRoot, readJson, readSrc } = require("./helpers/sourceReader")

const recordCommands = [
  ["bobBazaar.records.initCampaign", "実績 campaign を初期化"],
  ["bobBazaar.records.createRecord", "実績 record を作成"],
  ["bobBazaar.records.validateRecord", "実績 record を検証"],
  ["bobBazaar.records.createTriage", "人間 triage 雛形を生成"],
  ["bobBazaar.records.validateTriage", "人間 triage を検証"],
  ["bobBazaar.records.generateSummary", "実績 campaign summary を生成"]
]

test("Phase 1 review record commands are exposed in package.json", () => {
  const packageJson = readJson("package.json")
  const commands = new Map(packageJson.contributes.commands.map((command) => [command.command, command]))
  const activationEvents = new Set(packageJson.activationEvents)
  const paletteCommands = new Set(packageJson.contributes.menus.commandPalette.map((entry) => entry.command))

  for (const [commandId, title] of recordCommands) {
    assert.equal(commands.get(commandId)?.title, title, `${commandId} title`)
    assert.equal(commands.get(commandId)?.category, "Bob Bazaar Review", `${commandId} category`)
    assert.ok(activationEvents.has(`onCommand:${commandId}`), `${commandId} activation event`)
    assert.ok(paletteCommands.has(commandId), `${commandId} command palette entry`)
  }
})

test("Phase 1 review record commands are registered from the extension composition root", () => {
  const extensionSource = readSrc("extension.ts")
  const commandSourcePath = path.join(extensionRoot, "src", "records", "reviewRecordCommands.ts")
  assert.ok(fs.existsSync(commandSourcePath), "records/reviewRecordCommands.ts must exist")
  const commandSource = fs.readFileSync(commandSourcePath, "utf8")

  assert.match(extensionSource, /import \{ registerReviewRecordCommands \} from "\.\/records\/reviewRecordCommands"/)
  assert.match(extensionSource, /registerReviewRecordCommands\(context\)/)

  for (const [commandId] of recordCommands) {
    assert.match(commandSource, new RegExp(`registerCommand\\("${commandId.replaceAll(".", "\\.")}"`))
  }
  assert.match(commandSource, /context\.asAbsolutePath\(path\.join\("templates", "\.bob-review-records"\)\)/)
  assert.match(commandSource, /writeReviewRecord\(/)
  assert.match(commandSource, /writeReviewPacketArtifact\(/)
  assert.match(commandSource, /createTriageDraft\(/)
  assert.match(commandSource, /generateCampaignSummary\(/)
})
