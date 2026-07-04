import { firstKnownId, matchingChunks, type ExtractedChunk } from "./documentExtractionCommon"

export function extractMarkdownChunks(markdown: string, evidenceType: string, selectors: string[]): ExtractedChunk[] {
  const blocks: Array<{ heading: string; headingPath: string[]; text: string }> = []
  const lines = markdown.split(/\r?\n/)
  let headingPath: string[] = []
  let currentHeading = "document"
  let current: string[] = []

  const flush = () => {
    const text = current.join("\n").trim()
    if (text) blocks.push({ heading: currentHeading, headingPath: [...headingPath], text })
    current = []
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      flush()
      const level = heading[1].length
      currentHeading = heading[2].trim()
      headingPath = [...headingPath.slice(0, level - 1), currentHeading]
    }
    current.push(line)
  }
  flush()

  return matchingChunks(blocks.map((block) => ({
    evidenceType,
    ref: firstKnownId(block.text) ?? block.heading,
    title: block.heading,
    location: block.headingPath.join(" > "),
    headingPath: block.headingPath,
    text: block.text
  })), selectors)
}
