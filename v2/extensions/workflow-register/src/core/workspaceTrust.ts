export type WorkspaceTrustCheck = () => boolean

export function workspaceTrustError(action: string): string {
  return `Workspace is not trusted. Trust this workspace before ${action}.`
}

export function requireWorkspaceTrust(isWorkspaceTrusted: WorkspaceTrustCheck | undefined, action: string): void {
  if (isWorkspaceTrusted && !isWorkspaceTrusted()) throw new Error(workspaceTrustError(action))
}
