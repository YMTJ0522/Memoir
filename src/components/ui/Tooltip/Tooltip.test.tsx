import { act, cleanup, render, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

afterEach(cleanup);

const RECT = { width: 40, height: 24, top: 0, left: 0, bottom: 24, right: 40, x: 0, y: 0, toJSON: () => undefined };

function hoverTrigger(view: ReturnType<typeof render>) {
  const button = view.getByRole("button");
  Object.defineProperty(button, "getBoundingClientRect", { value: () => RECT });
  // The setup mock reports (hover: none), so bypass the fine-pointer gate by
  // faking a hover-capable pointer for this suite, then hover the trigger.
  const spy = vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    media: "(hover: hover) and (pointer: fine)",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  } as MediaQueryList);
  act(() => {
    // React derives onMouseEnter from native mouseover (mouseenter never
    // bubbles, so React's root listener cannot see it directly).
    fireEvent.mouseOver(button);
  });
  spy.mockRestore();
}

describe("Tooltip", () => {
  it("shows the label on hover after the delay", () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <Tooltip label="标题">
          <button type="button">触发</button>
        </Tooltip>,
      );
      hoverTrigger(view);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(view.getByRole("tooltip")).toHaveTextContent("标题");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never shows while suppressed, even after hover", () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <Tooltip label="标题" suppress>
          <button type="button">触发</button>
        </Tooltip>,
      );
      hoverTrigger(view);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(view.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops re-arming after suppression begins mid-hover", () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <Tooltip label="标题">
          <button type="button">触发</button>
        </Tooltip>,
      );
      hoverTrigger(view);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // Menu opens: suppression flips on mid-hover; pending timer must die.
      view.rerender(
        <Tooltip label="标题" suppress>
          <button type="button">触发</button>
        </Tooltip>,
      );
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(view.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

