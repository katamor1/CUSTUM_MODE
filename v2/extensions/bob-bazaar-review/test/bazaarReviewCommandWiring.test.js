const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readSrc } = require("./helpers/sourceReader")

test("Bazaar review commands stop after creating markdown when IBM Bob is absent", () => {
  const source = readSrc("bazaar", "bazaarReviewCommands.ts")

  assert.match(source, /import \{ isBobCodeExtensionAvailable \} from "\.\.\/bob\/bobCodeExtension"/)
  assert.match(source, /if \(!isBobCodeExtensionAvailable\(\)\) \{[\s\S]*IBM Bob 拡張機能が見つからないため[\s\S]*return[\s\S]*\}/)
  assert.match(source, /Markdown を作成しました/)
})

test("Bazaar review commands auto-add the generated packet to Bob when workflow-register is absent", () => {
  const source = readSrc("bazaar", "bazaarReviewCommands.ts")

  assert.match(source, /isWorkflowRegisterExtensionAvailable\(\)/)
  assert.match(source, new RegExp([
    "if \\(!isWorkflowRegisterExtensionAvailable\\(\\)\\) \\{",
    "const result = await addPacketToBobContext\\(editor\\.document\\.uri, packet\\)",
    "workflow-register 未導入"
  ].join("[\\s\\S]*")))
  assert.match(source, /Bob チャットへ挿入しました/)
})

test("Bazaar direct review commands include the same target context as the GUI packet path", () => {
  const source = readSrc("bazaar", "bazaarReviewCommands.ts")

  assert.match(source, /prepareTarget\(client,\s*bazaarFolder\.uri\.fsPath,\s*\{\s*mode:\s*"singleRevision"/s)
  assert.match(source, /prepareTarget\(client,\s*bazaarFolder\.uri\.fsPath,\s*\{\s*mode:\s*"revisionRange"/s)
  assert.match(source, /buildTargetMetadataSection\(prepared\.info\)/)
  assert.match(source, /prepared\.addedFilesSection/)
  assert.match(source, /log:\s*prepared\.log/)
})
