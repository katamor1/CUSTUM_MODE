const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function selectDevRendererUrl(
  candidateUrl: string | undefined,
  isPackaged: boolean
): string | undefined {
  if (isPackaged || !candidateUrl) {
    return undefined;
  }

  try {
    const url = new URL(candidateUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:")
      || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

export function isTrustedRendererUrl(
  senderUrl: string | undefined,
  devRendererUrl: string | undefined,
  isPackaged: boolean
): boolean {
  if (!senderUrl) {
    return false;
  }

  try {
    const sender = new URL(senderUrl);
    if (sender.protocol === "file:") {
      return true;
    }

    const selectedDevUrl = selectDevRendererUrl(devRendererUrl, isPackaged);
    return selectedDevUrl !== undefined
      && sender.origin === new URL(selectedDevUrl).origin;
  } catch {
    return false;
  }
}
