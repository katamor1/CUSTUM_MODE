export interface BzrPathConfigInspection {
  defaultValue?: string
  globalValue?: string
  workspaceValue?: string
  workspaceFolderValue?: string
}

export interface BzrPathConfigReader {
  get<T>(section: string, fallback: T): T
  inspect<T>(section: string): BzrPathConfigInspection | undefined
}

export function resolveBzrPath(config: BzrPathConfigReader, workspaceTrusted: boolean): string {
  const inspected = config.inspect<string>("bzrPath")
  if (!workspaceTrusted) {
    // 実行ファイルパスはコード実行境界なので、未信頼ワークスペースでは workspace 設定を採用しない。
    return firstNonBlank(inspected?.globalValue, inspected?.defaultValue, "bzr")
  }
  // workflow 引数ではなく VS Code の信頼済み設定だけを executable override として扱う。
  return firstNonBlank(
    inspected?.workspaceFolderValue,
    inspected?.workspaceValue,
    inspected?.globalValue,
    inspected?.defaultValue,
    config.get<string>("bzrPath", "bzr")
  )
}

function firstNonBlank(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return "bzr"
}
