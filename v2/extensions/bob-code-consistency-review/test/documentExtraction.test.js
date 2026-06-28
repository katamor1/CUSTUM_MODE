const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const XLSX = require("xlsx")

const { extractDocuments } = require("../out/analyzers/documentExtractor")

const DOCX_BASE64 = "UEsDBBQAAAAIANMd3VysAs59IgEAAGgCAAARAAAAd29yZC9kb2N1bWVudC54bWyUUk1rwkAQ/SvL3s2qhVKCiZem1EOptfFc1s1UA/uRzk5M8u/LZouCVUov82B5H/OYXSx7o9kR0NfOZnyWTDkDq1xV233Gt+XT5IEzT9JWUjsLGR/A82W+6NLKqdaAJdYbbX3aZfxA1KRCeHUAI33iGrC90Z8OjSSfONyLzmHVoFPgfW33Rov5dHovjKwtD5Y7Vw0Bm3GscYR3GjSwLj1KnfFnkGGzGRf5Qpw446B8U7xN7uYzVtYGXEsM4autEcKSgUyjBKPwFHOhRaAWrWfFZvNRrl6K123JugNYRj+mTqkWfXLVkHZ6hOipLjNWj1dU4WVk/uYXfQOKoLqtChDJNyJjrfk/c8/d/4wOEFt7ULTGeJd4SHH+JPk3AAAA//8DAFBLAwQUAAAACADTHd1ceW4z1/IAAACtAQAAEwAAAFtDb250ZW50X1R5cGVzXS54bWx8kMtOwzAQRX/F8hbFDiwQQnG64LEEFuUDLHuSWLVnLI8b0r9HaUsXqLC+j3N1u82SopihcCA08la1UgA68gFHIz+3r82DFFwtehsJwcgDsNz03faQgcWSIrKRU635UWt2EyTLijLgkuJAJdnKisqos3U7O4K+a9t77QgrYG3q2iH77hkGu49VvCwV8LSjQGQpnk7GlWWkzTkGZ2sg1DP6X5TmTFAF4tHDU8h8s6Qo9VXCqvwNOOfeZygleBAfttQ3m8BI/UXFa09unwCr+r/myk4ahuDgkl/bciEHzAHHFNVFSTbgz359vLv/BgAA//8DAFBLAwQUAAAACADTHd1cm/036rcAAAApAQAACwAAAF9yZWxzLy5yZWxzjM/BasMwEATQXxF7r+XkEEKw7EsI5FrcDxDS2haVdoVWTZ2/zyWHOPTQ6zC8YbphTVHdsEhgMrBrWlBIjn2g2cDXePk4gpJqydvIhAbuKDD03SdGWwOTLCGLWlMkMbDUmk9ai1swWWk4I60pTlySrdJwmXW27tvOqPdte9Dl1YCtqa7eQLn6HajxnvE/Nk9TcHhm95OQ6h8Tbw1Qoy0zVgO/XLz2z7hZUwTdd3pzsX8AAAD//wMAUEsBAhQAFAAAAAgA0x3dXKwCzn0iAQAAaAIAABEAAAAAAAAAAAAAAAAAAAAAAHdvcmQvZG9jdW1lbnQueG1sUEsBAhQAFAAAAAgA0x3dXHluM9fyAAAArQEAABMAAAAAAAAAAAAAAAAAUQEAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACADTHd1cm/036rcAAAApAQAACwAAAAAAAAAAAAAAAAB0AgAAX3JlbHMvLnJlbHNQSwUGAAAAAAMAAwC5AAAAVAMAAAAA"

test("extractDocuments reads Markdown, docx, and xlsx selectors with unique evidence ids", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bob-doc-extract-"))
  fs.mkdirSync(path.join(workspace, "docs"), { recursive: true })
  fs.writeFileSync(path.join(workspace, "docs", "requirements.md"), [
    "# REQ-123 Timeout",
    "",
    "REQ-123 returns ERR_TIMEOUT on timeout.",
    "",
    "| ID | Expected |",
    "|---|---|",
    "| REQ-124 | ERR_OK |",
    ""
  ].join("\n"))
  fs.writeFileSync(path.join(workspace, "docs", "requirements.docx"), Buffer.from(DOCX_BASE64, "base64"))

  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["ID", "Condition", "Expected"],
    ["DD-88", "timeout", "ERR_TIMEOUT"],
    ["DD-89", "normal", "ERR_OK"]
  ])
  XLSX.utils.book_append_sheet(workbook, worksheet, "timeout")
  XLSX.writeFile(workbook, path.join(workspace, "docs", "detail.xlsx"))

  const result = await extractDocuments({
    schema_version: 1,
    review: { id: "REVIEW-DOC", title: "doc extraction", change_type: "bugfix", purpose: "test", base: "a", head: "b" },
    artifacts: {
      requirements: [
        { path: "docs/requirements.md", version: "1.0", sections: ["REQ-123"] },
        { path: "docs/requirements.docx", version: "1.0", sections: ["REQ-321"] }
      ],
      detailed_design: [
        { path: "docs/detail.xlsx", version: "1.0", sheets: ["timeout"], rows: ["DD-88"] }
      ]
    },
    review_focus: ["requirement-code-consistency"]
  }, { workspaceRoot: workspace })

  const ids = result.evidence.map((item) => item.evidence_id)
  assert.equal(new Set(ids).size, ids.length)
  assert.match(result.excerptsMarkdown, /REQ-123/)
  assert.match(result.excerptsMarkdown, /REQ-321/)
  assert.match(result.excerptsMarkdown, /DD-88/)
  assert.match(result.excerptsMarkdown, /ERR_TIMEOUT/)
  assert.ok(result.documents.length >= 3)
})
