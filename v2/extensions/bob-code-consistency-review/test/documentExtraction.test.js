const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

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

  writeXlsxFixture(path.join(workspace, "docs", "detail.xlsx"))

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

function writeXlsxFixture(filePath) {
  const sheetXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>ID</t></is></c><c r="B1" t="inlineStr"><is><t>Condition</t></is></c><c r="C1" t="inlineStr"><is><t>Expected</t></is></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>DD-88</t></is></c><c r="B2" t="inlineStr"><is><t>timeout</t></is></c><c r="C2" t="inlineStr"><is><t>ERR_TIMEOUT</t></is></c></row>',
    '<row r="3"><c r="A3" t="inlineStr"><is><t>DD-89</t></is></c><c r="B3" t="inlineStr"><is><t>normal</t></is></c><c r="C3" t="inlineStr"><is><t>ERR_OK</t></is></c></row>',
    '</sheetData>',
    '</worksheet>'
  ].join("")

  fs.writeFileSync(filePath, createStoredZip({
    "[Content_Types].xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      '</Types>'
    ].join(""),
    "_rels/.rels": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
      '</Relationships>'
    ].join(""),
    "xl/workbook.xml": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<sheets><sheet name="timeout" sheetId="1" r:id="rId1"/></sheets>',
      '</workbook>'
    ].join(""),
    "xl/_rels/workbook.xml.rels": [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '</Relationships>'
    ].join(""),
    "xl/worksheets/sheet1.xml": sheetXml
  }))
}

function createStoredZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const [name, text] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8")
    const data = Buffer.from(text, "utf8")
    const crc = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, nameBuffer, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, nameBuffer)
    offset += localHeader.length + nameBuffer.length + data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Object.keys(entries).length, 8)
  end.writeUInt16LE(Object.keys(entries).length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})
