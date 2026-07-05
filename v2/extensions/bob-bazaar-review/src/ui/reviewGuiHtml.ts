import { randomBytes } from "node:crypto"
import { REVIEW_GUI_BODY, REVIEW_GUI_STYLE, renderReviewGuiScript } from "./reviewGuiHtmlAssets"
import type { BazaarReviewInitialTarget } from "./reviewGuiTypes"

export function renderHtml(cspSource: string, initialTarget?: BazaarReviewInitialTarget): string {
  const nonce = createNonce()
  const initialTargetJson = JSON.stringify(initialTarget ?? {}).replace(/</g, "\\u003c")

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bob Bazaar レビュー</title>
  <style>${REVIEW_GUI_STYLE}</style>
</head>
<body>${REVIEW_GUI_BODY}
  ${renderReviewGuiScript(nonce, initialTargetJson)}
</body>
</html>`
}

export function createNonce(): string {
  return randomBytes(16).toString("base64")
}
