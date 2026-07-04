import type { UiRunState } from "./uiText";

export function isJobBusy(state: UiRunState): boolean {
  return state === "running" || state === "cancelling";
}

export function canUseSettings(settingsLoaded: boolean, state: UiRunState): boolean {
  return settingsLoaded && !isJobBusy(state);
}
