const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")

const { classifyLanguageFromPath, isCLikeLanguage } = require("../out/core/languageClassifier")

const extensionRoot = path.resolve(__dirname, "..")

test("classifyLanguageFromPath maps common review languages to stable names", () => {
  assert.equal(classifyLanguageFromPath("src/payment_status.c"), "c")
  assert.equal(classifyLanguageFromPath("include/payment_status.hpp"), "hpp")
  assert.equal(classifyLanguageFromPath("web/components/checkout.tsx"), "typescript")
  assert.equal(classifyLanguageFromPath("web/components/checkout.jsx"), "javascript")
  assert.equal(classifyLanguageFromPath("tools/reconcile.py"), "python")
  assert.equal(classifyLanguageFromPath("services/PaymentReview.cs"), "csharp")
  assert.equal(classifyLanguageFromPath("app/src/main/java/com/example/PaymentReview.java"), "java")
  assert.equal(classifyLanguageFromPath("cmd/review/main.go"), "go")
  assert.equal(classifyLanguageFromPath("src/lib.rs"), "rust")
  assert.equal(classifyLanguageFromPath("scripts/run-review.ps1"), "shell")
  assert.equal(classifyLanguageFromPath("db/review.sql"), "sql")
  assert.equal(classifyLanguageFromPath("config/review.yaml"), "yaml")
  assert.equal(classifyLanguageFromPath("docs/review.md"), "markdown")
  assert.equal(classifyLanguageFromPath("README"), "unknown")
})

test("isCLikeLanguage only includes languages handled by the C/C++ analyzer", () => {
  assert.equal(isCLikeLanguage("c"), true)
  assert.equal(isCLikeLanguage("cpp"), true)
  assert.equal(isCLikeLanguage("h"), true)
  assert.equal(isCLikeLanguage("hpp"), true)
  assert.equal(isCLikeLanguage("typescript"), false)
  assert.equal(isCLikeLanguage("python"), false)
})

test("review-input schemas allow the supported Phase 2 language filter values", () => {
  const runtimeSchema = JSON.parse(fs.readFileSync(path.join(extensionRoot, "resources", "schemas", "review-input.schema.json"), "utf8"))
  const docsSchema = JSON.parse(fs.readFileSync(path.join(extensionRoot, "..", "..", "docs", "workflows", "code-consistency-review", "schemas", "review-input.schema.json"), "utf8"))
  const runtimeEnum = runtimeSchema.properties.analysis_options.properties.language.items.enum
  const docsEnum = docsSchema.properties.analysis_options.properties.language.items.enum

  for (const language of ["typescript", "javascript", "python", "csharp", "java", "go", "rust", "shell", "sql", "json", "yaml", "markdown", "text", "unknown"]) {
    assert.ok(runtimeEnum.includes(language), `runtime schema should include ${language}`)
    assert.ok(docsEnum.includes(language), `docs schema should include ${language}`)
  }
})

test("default review-input authoring does not constrain analysis to C headers only", () => {
  const builderSource = fs.readFileSync(path.join(extensionRoot, "src", "core", "reviewInputBuilder.ts"), "utf8")
  const initializerSource = fs.readFileSync(path.join(extensionRoot, "src", "workspaceInitializer.ts"), "utf8")

  assert.doesNotMatch(builderSource, /language:\s*\[\s*"c",\s*"h"\s*\]/)
  assert.doesNotMatch(initializerSource, /language:\s*\r?\n\s*-\s*c\r?\n\s*-\s*h/)
})
