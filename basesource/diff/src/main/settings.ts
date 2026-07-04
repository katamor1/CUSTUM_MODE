import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  validateAppSettings,
  type AppSettings
} from "../shared/settings";

export async function loadSettingsFile(
  settingsPath: string,
  defaults: AppSettings = DEFAULT_APP_SETTINGS
): Promise<AppSettings> {
  try {
    return normalizeAppSettings(JSON.parse(await readFile(settingsPath, "utf8")), defaults);
  } catch {
    return normalizeAppSettings(undefined, defaults);
  }
}

export async function saveSettingsFile(
  settingsPath: string,
  settings: unknown,
  _defaults: AppSettings = DEFAULT_APP_SETTINGS
): Promise<void> {
  if (!validateAppSettings(settings)) {
    throw new Error("設定値が不正です");
  }

  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
