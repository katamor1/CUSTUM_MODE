const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

test("refreshTemplateFile backs up an existing different file before overwriting", async () => {
  const { refreshTemplateFile } = require("../out/workspace/templateRefresh")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-template-refresh-"))
  const source = path.join(root, "source", "WORKFLOW.md")
  const target = path.join(root, "workspace", ".bob", "workflows", "review", "WORKFLOW.md")
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(source, "template workflow\n", "utf8")
  await fs.writeFile(target, "custom workflow\n", "utf8")

  const result = await refreshTemplateFile(source, target)

  assert.equal(result.refreshed, true)
  assert.ok(result.backupPath)
  assert.equal(await fs.readFile(target, "utf8"), "template workflow\n")
  assert.equal(await fs.readFile(result.backupPath, "utf8"), "custom workflow\n")
})

test("refreshTemplateFile skips identical files without creating backups", async () => {
  const { refreshTemplateFile } = require("../out/workspace/templateRefresh")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-template-refresh-same-"))
  const source = path.join(root, "source", "WORKFLOW.md")
  const target = path.join(root, "workspace", ".bob", "workflows", "review", "WORKFLOW.md")
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(source, "template workflow\n", "utf8")
  await fs.writeFile(target, "template workflow\n", "utf8")

  const result = await refreshTemplateFile(source, target)
  const entries = await fs.readdir(path.dirname(target))

  assert.equal(result.refreshed, false)
  assert.equal(result.backupPath, undefined)
  assert.deepEqual(entries, ["WORKFLOW.md"])
})

test("refreshTemplateFile leaves an existing different file untouched when overwrite confirmation is declined", async () => {
  const { refreshTemplateFile } = require("../out/workspace/templateRefresh")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-template-refresh-decline-"))
  const source = path.join(root, "source", "WORKFLOW.md")
  const target = path.join(root, "workspace", ".bob", "workflows", "review", "WORKFLOW.md")
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(source, "template workflow\n", "utf8")
  await fs.writeFile(target, "custom workflow\n", "utf8")

  const result = await refreshTemplateFile(source, target, {
    confirmOverwrite: async () => false
  })
  const entries = await fs.readdir(path.dirname(target))

  assert.equal(result.refreshed, false)
  assert.equal(result.backupPath, undefined)
  assert.equal(await fs.readFile(target, "utf8"), "custom workflow\n")
  assert.deepEqual(entries, ["WORKFLOW.md"])
})

test("refreshTemplateFile passes a bounded diff preview to overwrite confirmation", async () => {
  const { refreshTemplateFile } = require("../out/workspace/templateRefresh")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bob-bazaar-template-refresh-preview-"))
  const source = path.join(root, "source", "WORKFLOW.md")
  const target = path.join(root, "workspace", ".bob", "workflows", "review", "WORKFLOW.md")
  const previews = []
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(source, ["name: template", "workspaceRequired: false", "new step"].join("\n"), "utf8")
  await fs.writeFile(target, ["name: custom", "workspaceRequired: true", "custom step"].join("\n"), "utf8")

  const result = await refreshTemplateFile(source, target, {
    confirmOverwrite: async (preview) => {
      previews.push(preview)
      return true
    }
  })

  assert.equal(result.refreshed, true)
  assert.equal(previews.length, 1)
  assert.equal(previews[0].sourcePath, source)
  assert.equal(previews[0].targetPath, target)
  assert.match(previews[0].diffPreview, /--- .*WORKFLOW\.md/)
  assert.match(previews[0].diffPreview, /\+\+\+ .*WORKFLOW\.md/)
  assert.match(previews[0].diffPreview, /-workspaceRequired: true/)
  assert.match(previews[0].diffPreview, /\+workspaceRequired: false/)
  assert.ok(previews[0].diffPreview.length <= 12000)
})
