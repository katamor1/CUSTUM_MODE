const TEXT_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0c, 0x0d]);
const BINARY_CONTROL_RATIO = 0.3;

export function isTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }

  let controlBytes = 0;
  for (const byte of buffer) {
    if (byte === 0x00) {
      return false;
    }

    if (byte < 0x20 && !TEXT_CONTROL_BYTES.has(byte)) {
      controlBytes += 1;
    }
  }

  return controlBytes / buffer.length <= BINARY_CONTROL_RATIO;
}
