interface FocusableControl {
  disabled?: boolean;
  tabIndex: number;
  getAttribute(name: string): string | null;
  focus(): void;
}

interface FocusContainer {
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

interface TabKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

const FOCUSABLE_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a[href]",
  "[tabindex]"
].join(",");

export function focusFirstModalControl(container: FocusContainer): void {
  focusableControls(container)[0]?.focus();
}

export function trapModalTab(
  event: TabKeyEvent,
  container: FocusContainer,
  activeElement: unknown
): void {
  if (event.key !== "Tab") {
    return;
  }

  const controls = focusableControls(container);
  if (controls.length === 0) {
    event.preventDefault();
    return;
  }

  const first = controls[0];
  const last = controls.at(-1)!;
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusableControls(container: FocusContainer): FocusableControl[] {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(isFocusableControl)
    .filter((control) =>
      !control.disabled
      && control.tabIndex !== -1
      && control.getAttribute("aria-hidden") !== "true"
    );
}

function isFocusableControl(value: unknown): value is FocusableControl {
  return typeof value === "object"
    && value !== null
    && "focus" in value
    && typeof value.focus === "function"
    && "getAttribute" in value
    && typeof value.getAttribute === "function"
    && "tabIndex" in value
    && typeof value.tabIndex === "number";
}
