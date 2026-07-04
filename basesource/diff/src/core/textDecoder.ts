import { readFile } from "node:fs/promises";
import { TextDecoder } from "node:util";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SHIFT_JIS_DECODER = new TextDecoder("shift_jis");

export async function readTextFile(filePath: string): Promise<string> {
  return decodeTextBuffer(await readFile(filePath));
}

export function decodeTextBuffer(buffer: Buffer): string {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    return SHIFT_JIS_DECODER.decode(buffer);
  }
}
