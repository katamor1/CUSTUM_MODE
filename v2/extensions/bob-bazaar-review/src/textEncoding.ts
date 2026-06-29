import { TextDecoder } from "node:util"

export type TextEncoding = "auto" | "utf8" | "shift_jis"

export function decodeTextBuffer(buffer: Buffer, encoding: string | undefined = "auto"): string {
  const normalized = normalizeTextEncoding(encoding)
  if (normalized === "utf8") return stripBom(buffer.toString("utf8"))
  if (normalized === "shift_jis") return stripBom(decodeShiftJis(buffer))

  const utf8 = stripBom(buffer.toString("utf8"))
  if (!utf8.includes("\uFFFD")) return utf8

  const shiftJis = stripBom(decodeShiftJis(buffer))
  return replacementCount(shiftJis) <= replacementCount(utf8) ? shiftJis : utf8
}

export function normalizeTextEncoding(value: string | undefined): TextEncoding {
  const normalized = (value ?? "auto").trim().toLowerCase().replace(/[-_]/g, "")
  if (!normalized || normalized === "auto") return "auto"
  if (normalized === "utf8" || normalized === "utf") return "utf8"
  if (["shiftjis", "sjis", "cp932", "windows31j", "mskanji"].includes(normalized)) return "shift_jis"
  return "auto"
}

function decodeShiftJis(buffer: Buffer): string {
  return new TextDecoder("shift_jis").decode(buffer)
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function replacementCount(value: string): number {
  return (value.match(/\uFFFD/g) ?? []).length
}
