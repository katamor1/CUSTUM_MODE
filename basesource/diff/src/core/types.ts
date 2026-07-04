export type FilePairStatus = "modified" | "added" | "deleted";

export interface ComparableFilePair {
  relativePath: string;
  leftPath?: string;
  rightPath?: string;
  status: FilePairStatus;
}

export interface ChangedFileEntry extends ComparableFilePair {
  isText: boolean;
}
