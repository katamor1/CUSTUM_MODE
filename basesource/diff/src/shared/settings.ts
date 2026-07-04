export interface RowOutputPolicy {
  contextRows: number;
  hideRetainedRows: boolean;
}

export interface AppSettings {
  winMergePath: string;
  bazaarPath: string;
  lastOutputDirectory: string;
  rowOutput: {
    cFiles: RowOutputPolicy;
    otherTextFiles: RowOutputPolicy;
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  winMergePath: "",
  bazaarPath: "brz",
  lastOutputDirectory: "",
  rowOutput: {
    cFiles: { contextRows: 100, hideRetainedRows: true },
    otherTextFiles: { contextRows: 100, hideRetainedRows: true }
  }
};

export function validateRowOutputPolicy(value: unknown): value is RowOutputPolicy {
  const policy = asRecord(value);
  return policy !== undefined
    && Number.isSafeInteger(policy.contextRows)
    && typeof policy.contextRows === "number"
    && policy.contextRows >= 0
    && typeof policy.hideRetainedRows === "boolean";
}

export function validateAppSettings(value: unknown): value is AppSettings {
  const settings = asRecord(value);
  const rowOutput = asRecord(settings?.rowOutput);
  return settings !== undefined
    && typeof settings.winMergePath === "string"
    && typeof settings.bazaarPath === "string"
    && typeof settings.lastOutputDirectory === "string"
    && rowOutput !== undefined
    && validateRowOutputPolicy(rowOutput.cFiles)
    && validateRowOutputPolicy(rowOutput.otherTextFiles);
}

export function normalizeAppSettings(
  value: unknown,
  defaults: AppSettings = DEFAULT_APP_SETTINGS
): AppSettings {
  const settings = asRecord(value);
  const rowOutput = asRecord(settings?.rowOutput);

  return {
    winMergePath: stringOrDefault(settings?.winMergePath, defaults.winMergePath),
    bazaarPath: stringOrDefault(settings?.bazaarPath, defaults.bazaarPath),
    lastOutputDirectory: stringOrDefault(settings?.lastOutputDirectory, defaults.lastOutputDirectory),
    rowOutput: {
      cFiles: normalizeRowOutputPolicy(rowOutput?.cFiles, defaults.rowOutput.cFiles),
      otherTextFiles: normalizeRowOutputPolicy(rowOutput?.otherTextFiles, defaults.rowOutput.otherTextFiles)
    }
  };
}

function normalizeRowOutputPolicy(value: unknown, defaults: RowOutputPolicy): RowOutputPolicy {
  const policy = asRecord(value);
  const contextRows = policy?.contextRows;
  const hideRetainedRows = policy?.hideRetainedRows;

  return {
    contextRows: typeof contextRows === "number" && Number.isSafeInteger(contextRows) && contextRows >= 0
      ? contextRows
      : defaults.contextRows,
    hideRetainedRows: typeof hideRetainedRows === "boolean"
      ? hideRetainedRows
      : defaults.hideRetainedRows
  };
}

function stringOrDefault(value: unknown, defaultValue: string): string {
  return typeof value === "string" ? value : defaultValue;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
