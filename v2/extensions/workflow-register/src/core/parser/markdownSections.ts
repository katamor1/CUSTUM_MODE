export function parseStepHeading(text: string): string | undefined {
  return text.trim().match(/^Step(?::|\s+)\s*([A-Za-z0-9_.-]+)\s*$/i)?.[1]
}

export function extractMarkdownSection(markdown: string, headingName: string): string | undefined {
  const lines = markdown.split(/\r?\n/)
  let start = -1
  let level = 0
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading && heading[2].trim().toLowerCase() === headingName.toLowerCase()) {
      start = index + 1
      level = heading[1].length
      break
    }
  }
  if (start < 0) return undefined
  const body: string[] = []
  for (let index = start; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+/)
    if (heading && heading[1].length <= level) break
    body.push(lines[index])
  }
  return body.join("\n").trim()
}

export function removeMarkdownSection(markdown: string, headingName: string): string {
  const lines = markdown.split(/\r?\n/)
  let start = -1
  let level = 0
  let end = lines.length
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading && heading[2].trim().toLowerCase() === headingName.toLowerCase()) {
      start = index
      level = heading[1].length
      break
    }
  }
  if (start < 0) return markdown
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+/)
    if (heading && heading[1].length <= level) {
      end = index
      break
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n")
}

export function removeMarkdownStepSections(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const kept: string[] = []
  for (let index = 0; index < lines.length;) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!heading || !parseStepHeading(heading[2])) {
      kept.push(lines[index])
      index += 1
      continue
    }
    const level = heading[1].length
    index += 1
    while (index < lines.length) {
      const nextHeading = lines[index].match(/^(#{1,6})\s+/)
      if (nextHeading && nextHeading[1].length <= level) break
      index += 1
    }
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n")
}
