export function buildBazaarExportArgs(repositoryPath: string, revision: string, outputDirectory: string): string[] {
  return ["--no-aliases", "export", "-r", revision, outputDirectory, repositoryPath];
}
