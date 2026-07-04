export function buildWinMergeReportArgs(leftFile: string, rightFile: string, reportHtml: string): string[] {
  return ["/noninteractive", "/minimize", "/u", leftFile, rightFile, "/or", reportHtml];
}
