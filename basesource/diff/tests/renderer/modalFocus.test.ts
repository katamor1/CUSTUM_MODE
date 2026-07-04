import { describe, expect, it, vi } from "vitest";
import {
  focusFirstModalControl,
  trapModalTab
} from "../../src/renderer/src/modalFocus";

describe("modal focus management", () => {
  it("moves initial focus to the first enabled control", () => {
    const disabled = focusTarget({ disabled: true });
    const first = focusTarget();
    const last = focusTarget();
    const container = fakeContainer([disabled, first, last]);

    focusFirstModalControl(container);

    expect(first.focus).toHaveBeenCalledOnce();
    expect(disabled.focus).not.toHaveBeenCalled();
  });

  it("wraps Tab and Shift+Tab within the modal", () => {
    const first = focusTarget();
    const middle = focusTarget();
    const last = focusTarget();
    const container = fakeContainer([first, middle, last]);
    const forward = keyboardEvent(false);
    const backward = keyboardEvent(true);

    trapModalTab(forward, container, last);
    trapModalTab(backward, container, first);

    expect(first.focus).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();
    expect(forward.preventDefault).toHaveBeenCalledOnce();
    expect(backward.preventDefault).toHaveBeenCalledOnce();
  });
});

function focusTarget(options: { disabled?: boolean } = {}) {
  return {
    disabled: options.disabled ?? false,
    tabIndex: 0,
    getAttribute: () => null,
    focus: vi.fn()
  };
}

function fakeContainer(elements: ReturnType<typeof focusTarget>[]) {
  return {
    querySelectorAll: () => elements
  };
}

function keyboardEvent(shiftKey: boolean) {
  return {
    key: "Tab",
    shiftKey,
    preventDefault: vi.fn()
  };
}
