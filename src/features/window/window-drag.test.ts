import { afterEach, describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import { handleWindowDragMouseDown } from "./window-drag";

vi.mock("../../platform/runtime", () => ({
  isTauriRuntime: () => true,
}));

vi.mock("../../platform/window", () => ({
  startWindowDragging: vi.fn(),
}));

import { startWindowDragging } from "../../platform/window";

const startWindowDraggingMock = vi.mocked(startWindowDragging);

/** Build a React-like mouse event whose target is a detached element. */
function eventFrom(html: string): MouseEvent<HTMLElement> {
  const container = document.createElement("div");
  container.innerHTML = html;
  const target = container.firstElementChild as HTMLElement;
  return {
    button: 0,
    target,
  } as unknown as MouseEvent<HTMLElement>;
}

describe("handleWindowDragMouseDown", () => {
  afterEach(() => {
    startWindowDraggingMock.mockClear();
  });

  it("starts window dragging on a plain header area", () => {
    handleWindowDragMouseDown(eventFrom("<div class='header'></div>"));
    expect(startWindowDraggingMock).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks on buttons, inputs and ARIA interactive roles", () => {
    handleWindowDragMouseDown(eventFrom("<button>新对话</button>"));
    handleWindowDragMouseDown(eventFrom("<input type='text' />"));
    handleWindowDragMouseDown(eventFrom("<div role='switch'></div>"));
    handleWindowDragMouseDown(eventFrom("<div role='separator'></div>"));
    expect(startWindowDraggingMock).not.toHaveBeenCalled();
  });

  it("ignores clicks on select menu options so portal dropdowns stay clickable", () => {
    // Regression: portal Select menus bubble mousedown up to the header; the
    // AI session picker's options must not trigger window dragging.
    handleWindowDragMouseDown(
      eventFrom("<div role='listbox'><div role='option'>旧会话</div></div>"),
    );
    handleWindowDragMouseDown(eventFrom("<div role='menuitem'>菜单项</div>"));
    handleWindowDragMouseDown(eventFrom("<div data-window-drag='ignore'></div>"));
    expect(startWindowDraggingMock).not.toHaveBeenCalled();
  });
});
