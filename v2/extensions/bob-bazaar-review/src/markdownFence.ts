export function fencedCodeBlock(language: string | undefined, content: string): string {
  const fence = selectCodeFence(content)
  const info = language ? language.replace(/[` \t\r\n]+/g, "") : ""
  return [`${fence}${info}`, content, fence].join("\n")
}

export function selectCodeFence(content: string): string {
  let longest = 0
  for (const match of content.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length)
  }
  return "`".repeat(Math.max(3, longest + 1))
}
