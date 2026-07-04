const NON_NEGATIVE_INTEGER = /^\d+$/;

export function parseNonNegativeIntegerText(value: string): number | undefined {
  if (!NON_NEGATIVE_INTEGER.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
