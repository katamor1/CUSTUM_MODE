export type AddToBobContextResult = "added" | "clipboardFallback"

export interface BobContextInsertionDependencies {
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown> | unknown
  writeClipboard: (text: string) => Promise<unknown> | unknown
  showWarningMessage: (message: string) => Promise<unknown> | unknown
}

export async function addMarkdownPacketToBobContext(deps: BobContextInsertionDependencies, uri: unknown, packet: string): Promise<AddToBobContextResult> {
  try {
    await Promise.resolve(deps.executeCommand("bob-code.addToContext", uri, packet, 1, packet.split(/\r?\n/).length))
    return "added"
  } catch (error: unknown) {
    await Promise.resolve(deps.writeClipboard(packet))
    await Promise.resolve(deps.showWarningMessage(`Bob コンテキスト追加コマンドを呼び出せませんでした。代わりにレビュー packet をクリップボードへコピーしました。${errorMessage(error)}`))
    return "clipboardFallback"
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? ` ${error.message}` : ""
}
