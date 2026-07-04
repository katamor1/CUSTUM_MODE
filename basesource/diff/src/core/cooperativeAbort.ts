export async function cooperativeCheckpoint(
  signal?: AbortSignal,
  iteration = 0,
  interval = 1
): Promise<void> {
  signal?.throwIfAborted();
  if (iteration % interval !== 0) {
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}
