export function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

export function requireOption(args: string[], name: string): string {
  const value = readOption(args, name);
  if (!value) {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}
