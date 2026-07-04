import { describe, expect, it, vi } from "vitest";
import { createCloseCoordinator } from "../../src/main/windowClose";

describe("createCloseCoordinator", () => {
  it("prevents the first close, awaits cancellation, then allows final destruction", async () => {
    let finishCancellation!: () => void;
    const cancel = vi.fn(() => new Promise<void>((resolve) => {
      finishCancellation = resolve;
    }));
    const destroy = vi.fn();
    const coordinator = createCloseCoordinator({
      hasActiveJob: () => true,
      cancel,
      finalizeClose: destroy
    });
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };

    const closing = coordinator.handleClose(firstEvent);
    const duplicate = coordinator.handleClose(secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();

    finishCancellation();
    await Promise.all([closing, duplicate]);
    expect(destroy).toHaveBeenCalledOnce();

    const allowedEvent = { preventDefault: vi.fn() };
    await coordinator.handleClose(allowedEvent);
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("allows closing immediately when no job is active", async () => {
    const cancel = vi.fn(async () => undefined);
    const finalizeClose = vi.fn();
    const coordinator = createCloseCoordinator({
      hasActiveJob: () => false,
      cancel,
      finalizeClose
    });
    const event = { preventDefault: vi.fn() };

    await coordinator.handleClose(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(finalizeClose).not.toHaveBeenCalled();
  });
});
