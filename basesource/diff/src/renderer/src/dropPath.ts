export type DroppedPathResolver = (file: File) => Promise<string> | string;
export type DroppedDirectoryChecker = (path: string) => Promise<boolean> | boolean;

export async function resolveFirstDroppedPath(files: ArrayLike<File>, resolver: DroppedPathResolver): Promise<string | null> {
  const firstFile = files[0];
  if (!firstFile) {
    return null;
  }

  const resolvedPath = await resolver(firstFile);
  return resolvedPath.length > 0 ? resolvedPath : null;
}

export async function resolveFirstDroppedDirectoryPath(
  files: ArrayLike<File>,
  resolver: DroppedPathResolver,
  isDirectory: DroppedDirectoryChecker
): Promise<string | null> {
  const resolvedPath = await resolveFirstDroppedPath(files, resolver);
  if (!resolvedPath) {
    return null;
  }
  return await isDirectory(resolvedPath) ? resolvedPath : null;
}
