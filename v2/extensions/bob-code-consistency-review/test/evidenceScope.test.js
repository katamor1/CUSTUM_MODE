const assert = require("node:assert/strict")
const { test } = require("node:test")

const { buildEvidenceScope } = require("../out/evidenceScope/changeScopeEngine")
const { planContextBudget } = require("../out/evidenceScope/contextBudgetPlanner")
const { InMemoryDocumentEvidenceAdapter } = require("../out/evidenceScope/documentEvidenceAdapter")
const { selectApplicableRules } = require("../out/evidenceScope/rulePackEngine")
const { buildReviewEvidenceScope } = require("../out/evidenceScope/reviewEvidenceAdapter")

function symbol(id, overrides = {}) {
  return {
    id,
    name: id,
    path: `src/${id}.cpp`,
    kind: "function",
    language: "cpp",
    estimatedTokens: 40,
    riskTags: [],
    ...overrides
  }
}

test("change scope expands deterministic direct and two-hop impact while retaining unknown impact", () => {
  const request = {
    changedSymbolIds: ["changed"],
    symbols: [symbol("twoHop"), symbol("changed", { interfaceChange: true, riskTags: ["safety"] }), symbol("direct")],
    dependencyEdges: [
      { from: "direct", to: "twoHop", kind: "calls", resolution: "resolved", reason: "direct calls twoHop" },
      { from: "changed", to: "direct", kind: "calls", resolution: "resolved", reason: "changed calls direct" },
      { from: "changed", kind: "dynamic", resolution: "unknown", reason: "function pointer target unresolved", targetHint: "callback" }
    ],
    maxDependencyDepth: 2,
    rules: [],
    tokenBudget: 1000
  }

  const first = buildEvidenceScope(request)
  const second = buildEvidenceScope({ ...request, symbols: [...request.symbols].reverse(), dependencyEdges: [...request.dependencyEdges].reverse() })

  assert.deepEqual(first.selectedCode.map((item) => [item.id, item.priority]), [
    ["changed", "required"],
    ["direct", "high"],
    ["twoHop", "medium"]
  ])
  assert.deepEqual(first.unknownImpact, [{ sourceId: "changed", edgeKind: "dynamic", reason: "function pointer target unresolved", targetHint: "callback" }])
  assert.equal(first.scopeFingerprint, second.scopeFingerprint)
  assert.deepEqual(first.budgetReport, second.budgetReport)
})

test("rule pack applies structured path, language, risk, symbol kind, and interface conditions", () => {
  const changed = [
    symbol("api", {
      path: "src/public/api.cpp",
      kind: "function",
      interfaceChange: true,
      riskTags: ["security", "compatibility"]
    })
  ]
  const rules = [
    { id: "always", title: "Always", evaluation: "local" },
    {
      id: "api-security",
      title: "Public security API",
      evaluation: "ai",
      estimatedTokens: 120,
      appliesWhen: {
        paths: ["src/public/**"],
        languages: ["cpp"],
        symbolKinds: ["function"],
        riskTags: ["security"],
        interfaceChange: true
      }
    },
    {
      id: "python-only",
      title: "Python",
      evaluation: "local",
      appliesWhen: { languages: ["python"] }
    }
  ]

  assert.deepEqual(selectApplicableRules(rules, changed).map((rule) => rule.id), ["always", "api-security"])
})

test("document evidence adapter ranks symbol links before tags and removes duplicate ids", () => {
  const adapter = new InMemoryDocumentEvidenceAdapter([
    { id: "rule-doc", sourcePath: "docs/rules.md", locator: "# Security", contentHash: "b", estimatedTokens: 30, tags: ["security"] },
    { id: "symbol-doc", sourcePath: "docs/api.md", locator: "# api", contentHash: "a", estimatedTokens: 40, linkedSymbols: ["api"] },
    { id: "symbol-doc", sourcePath: "docs/api-copy.md", locator: "# duplicate", contentHash: "c", estimatedTokens: 20, linkedSymbols: ["api"] },
    { id: "unrelated", sourcePath: "docs/other.md", locator: "# Other", contentHash: "d", estimatedTokens: 10 }
  ])

  const query = {
    symbolIds: ["api"],
    riskTags: ["security"],
    ruleIds: ["api-security"],
    keywords: []
  }
  const result = adapter.findCandidates(query)
  const reversed = new InMemoryDocumentEvidenceAdapter([
    { id: "unrelated", sourcePath: "docs/other.md", locator: "# Other", contentHash: "d", estimatedTokens: 10 },
    { id: "symbol-doc", sourcePath: "docs/api-copy.md", locator: "# duplicate", contentHash: "c", estimatedTokens: 20, linkedSymbols: ["api"] },
    { id: "symbol-doc", sourcePath: "docs/api.md", locator: "# api", contentHash: "a", estimatedTokens: 40, linkedSymbols: ["api"] },
    { id: "rule-doc", sourcePath: "docs/rules.md", locator: "# Security", contentHash: "b", estimatedTokens: 30, tags: ["security"] }
  ]).findCandidates(query)

  assert.deepEqual(result.map((item) => item.id), ["symbol-doc", "rule-doc"])
  assert.equal(result[0].sourcePath, "docs/api.md")
  assert.deepEqual(reversed, result)
})

test("context budget always retains required entries and records policy and budget exclusions", () => {
  const report = planContextBudget([
    { id: "changed", kind: "code", priority: "required", estimatedTokens: 120, reasons: ["changed symbol"] },
    { id: "direct", kind: "code", priority: "high", estimatedTokens: 30, reasons: ["direct dependency"] },
    { id: "twoHop", kind: "code", priority: "medium", estimatedTokens: 30, reasons: ["two-hop dependency"] },
    { id: "raw-diff", kind: "code", priority: "low", estimatedTokens: 1, reasons: ["unscoped raw diff"] }
  ], { tokenBudget: 140, includeLowPriority: false })

  assert.deepEqual(report.selected.map((item) => item.id), ["changed"])
  assert.equal(report.overBudget, false)
  assert.deepEqual(report.excluded.map((item) => [item.id, item.exclusionReason]), [
    ["direct", "token-budget"],
    ["twoHop", "token-budget"],
    ["raw-diff", "low-priority-policy"]
  ])

  const overflow = planContextBudget([
    { id: "required", kind: "rule", priority: "required", estimatedTokens: 200, reasons: ["applicable rule"] }
  ], { tokenBudget: 100 })
  assert.equal(overflow.selected.length, 1)
  assert.equal(overflow.overBudget, true)
  assert.equal(overflow.requiredTokens, 200)
})

test("review adapter converts existing code and document analysis into a scoped result", () => {
  const analysis = {
    changedSymbols: [
      { id: "fn:api", name: "api", kind: "function", file: "src/api.cpp", confidence: "high", change_type: "signature", evidence_id: "CODE-1" }
    ],
    functions: [
      { id: "fn:api", name: "api", file: "src/api.cpp", line_after: "10", evidence_id: "CODE-1", callees: ["helper"], callers: [] },
      { id: "fn:helper", name: "helper", file: "src/helper.cpp", line_after: "20", evidence_id: "CODE-2", callees: [], callers: ["api"] }
    ],
    defines: [],
    globals: [],
    callGraph: [{ from: "api", to: "helper", confidence: "high", reason: "direct call" }],
    rtForbiddenCandidates: [],
    codeSlices: [
      { evidence_id: "CODE-1", file: "src/api.cpp", ref: "src/api.cpp#L10", functionName: "api", markdown: "", text: "int api(int value);" },
      { evidence_id: "CODE-2", file: "src/helper.cpp", ref: "src/helper.cpp#L20", functionName: "helper", markdown: "", text: "int helper();" }
    ],
    evidence: [],
    summaryMarkdown: "",
    warnings: []
  }
  const documents = {
    documents: [],
    excerptsMarkdown: "",
    evidence: [
      { evidence_id: "REQ-1", type: "requirement", ref: "docs/req.md#REQ-1", source: "docs/req.md", location: "REQ-1", text: "api compatibility requirement" }
    ],
    warnings: []
  }

  const result = buildReviewEvidenceScope(analysis, documents, {
    changedSymbolIds: ["fn:api"],
    tokenBudget: 1000,
    maxDependencyDepth: 1,
    rules: [
      { id: "public-api", title: "Public API compatibility", evaluation: "ai", estimatedTokens: 20, appliesWhen: { paths: ["src/api.cpp"] } }
    ],
    documentKeywords: ["api", "compatibility"]
  })

  assert.deepEqual(result.selectedCode.map((item) => item.id), ["fn:api", "fn:helper"])
  assert.deepEqual(result.applicableRules.map((rule) => rule.id), ["public-api"])
  assert.deepEqual(result.selectedDocuments.map((item) => item.id), ["REQ-1"])
  assert.ok(result.scopeFingerprint.startsWith("scope-"))
})

const { parseProjectRules } = require("../out/evidenceScope/projectRuleConfig")
const { createContextBudgetArtifact } = require("../out/evidenceScope/contextBudgetArtifact")

test("project rule config accepts structured bob_options rules and reports invalid entries", () => {
  const parsed = parseProjectRules([
    {
      id: "security-api",
      title: "Security API",
      evaluation: "ai",
      estimated_tokens: 90,
      applies_when: {
        paths: ["src/public/**"],
        languages: ["cpp"],
        symbol_kinds: ["function"],
        risk_tags: ["security"],
        interface_change: true
      }
    },
    { id: "broken", evaluation: "remote" }
  ])

  assert.deepEqual(parsed.rules, [{
    id: "security-api",
    title: "Security API",
    evaluation: "ai",
    estimatedTokens: 90,
    priority: "required",
    appliesWhen: {
      paths: ["src/public/**"],
      languages: ["cpp"],
      symbolKinds: ["function"],
      riskTags: ["security"],
      interfaceChange: true
    }
  }])
  assert.equal(parsed.warnings.length, 1)
  assert.match(parsed.warnings[0], /broken/)

  const invalidCamelCase = parseProjectRules([{
    id: "bad-tokens",
    title: "Bad token estimate",
    evaluation: "ai",
    estimatedTokens: "many"
  }])
  assert.equal(invalidCamelCase.rules.length, 0)
  assert.match(invalidCamelCase.warnings[0], /estimated_tokens/)
})

test("context budget artifact is deterministic and records VCS and selection policy", () => {
  const scope = buildEvidenceScope({
    changedSymbolIds: ["api"],
    symbols: [symbol("api")],
    dependencyEdges: [],
    maxDependencyDepth: 1,
    rules: [],
    tokenBudget: 100
  })
  const first = createContextBudgetArtifact(scope, {
    base: "abc",
    head: "def",
    tokenEstimation: "ceil(text.length / 4)",
    ruleSource: "review-input.bob_options.evidence_scope_rules"
  })
  const second = createContextBudgetArtifact(scope, {
    head: "def",
    base: "abc",
    ruleSource: "review-input.bob_options.evidence_scope_rules",
    tokenEstimation: "ceil(text.length / 4)"
  })

  assert.deepEqual(first, second)
  assert.equal(first.schema_version, 1)
  assert.equal(first.source_revision, "abc..def")
  assert.equal(first.selection_policy, "bob-evidence-scope-v1")
  assert.equal(first.scope_fingerprint, scope.scopeFingerprint)
})

test("evidence scope domain exposes a stable explicit public surface", () => {
  const api = require("../out/evidenceScope")
  assert.equal(typeof api.buildEvidenceScope, "function")
  assert.equal(typeof api.buildReviewEvidenceScope, "function")
  assert.equal(typeof api.planContextBudget, "function")
  assert.equal(typeof api.parseProjectRules, "function")
  assert.equal(typeof api.InMemoryDocumentEvidenceAdapter, "function")
})

test("invalid dependency depth is normalized to zero", () => {
  const result = buildEvidenceScope({
    changedSymbolIds: ["changed"],
    symbols: [symbol("changed"), symbol("direct")],
    dependencyEdges: [
      { from: "changed", to: "direct", kind: "calls", resolution: "resolved", reason: "direct call" }
    ],
    maxDependencyDepth: Number.NaN,
    rules: [],
    tokenBudget: 1000
  })

  assert.deepEqual(result.selectedCode.map((item) => item.id), ["changed"])
})

test("scope fingerprint changes when unknown-impact evidence changes", () => {
  const baseRequest = {
    changedSymbolIds: ["changed"],
    symbols: [symbol("changed")],
    maxDependencyDepth: 1,
    rules: [],
    tokenBudget: 1000
  }
  const first = buildEvidenceScope({
    ...baseRequest,
    dependencyEdges: [
      { from: "changed", kind: "dynamic", resolution: "unknown", reason: "callback target unresolved", targetHint: "callback" }
    ]
  })
  const second = buildEvidenceScope({
    ...baseRequest,
    dependencyEdges: [
      { from: "changed", kind: "dynamic", resolution: "unknown", reason: "reflection target unresolved", targetHint: "callback" }
    ]
  })

  assert.notEqual(first.scopeFingerprint, second.scopeFingerprint)
})
