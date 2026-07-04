import { firstKnownId, matchingChunks, rowsToMarkdown, type ExtractedChunk } from "./documentExtractionCommon"

type CheerioAPI = import("cheerio").CheerioAPI
type CheerioModule = typeof import("cheerio")
type MammothModule = typeof import("mammoth")

let cheerioModulePromise: Promise<CheerioModule> | undefined
let mammothModulePromise: Promise<MammothModule> | undefined

export async function extractDocxChunks(filePath: string, evidenceType: string, selectors: string[]): Promise<ExtractedChunk[]> {
  const [mammoth, cheerio] = await Promise.all([loadMammoth(), loadCheerio()])
  const html = (await mammoth.convertToHtml({ path: filePath })).value
  const $ = cheerio.load(html)
  const chunks: ExtractedChunk[] = []
  const headingPath: string[] = []

  $("body").children().each((_, element) => {
    const tag = element.tagName?.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1))
      headingPath.splice(level - 1, headingPath.length, $(element).text().trim())
      return
    }

    if (tag === "table") {
      const markdown = htmlTableToMarkdown($, element)
      if (markdown.trim()) {
        chunks.push({
          evidenceType,
          ref: firstKnownId(markdown) ?? headingPath.at(-1) ?? "table",
          title: headingPath.at(-1),
          location: headingPath.join(" > "),
          headingPath: [...headingPath],
          text: markdown
        })
      }
      return
    }

    const text = $(element).text().replace(/\s+/g, " ").trim()
    if (text) {
      chunks.push({
        evidenceType,
        ref: firstKnownId(text) ?? headingPath.at(-1) ?? "paragraph",
        title: headingPath.at(-1),
        location: headingPath.join(" > "),
        headingPath: [...headingPath],
        text
      })
    }
  })

  return matchingChunks(chunks, selectors)
}

function htmlTableToMarkdown($: CheerioAPI, table: any): string {
  const rows: string[][] = []
  $(table).find("tr").each((_, tr) => {
    const cells: string[] = []
    $(tr).find("th,td").each((__, cell) => {
      cells.push($(cell).text().replace(/\s+/g, " ").trim())
    })
    if (cells.some(Boolean)) rows.push(cells)
  })
  return rowsToMarkdown(rows)
}

function loadCheerio(): Promise<CheerioModule> {
  cheerioModulePromise ??= import("cheerio")
  return cheerioModulePromise
}

function loadMammoth(): Promise<MammothModule> {
  mammothModulePromise ??= import("mammoth")
  return mammothModulePromise
}
