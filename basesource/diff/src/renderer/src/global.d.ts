import type { DiffRepoApi } from "../../shared/ipcTypes";

declare global {
  interface Window {
    diffRepo: DiffRepoApi;
  }
}
