import type { MouseEvent } from "react";
import { isTauriRuntime } from "../../platform/runtime";
import { performWindowAction, startWindowDragging } from "../../platform/window";

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='switch']",
  "[role='separator']",
  "[role='option']",
  "[role='listbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[data-window-drag='ignore']",
].join(",");

let lastClickTime = 0;
let lastClickX = 0;
let lastClickY = 0;
const DOUBLE_CLICK_THRESHOLD = 300;
const DOUBLE_CLICK_DISTANCE = 5;

export function handleWindowDragMouseDown(event: MouseEvent<HTMLElement>) {
  if (!isTauriRuntime() || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest(INTERACTIVE_SELECTOR)) return;

  const now = Date.now();
  const dx = Math.abs(event.clientX - lastClickX);
  const dy = Math.abs(event.clientY - lastClickY);

  if (
    now - lastClickTime < DOUBLE_CLICK_THRESHOLD &&
    dx < DOUBLE_CLICK_DISTANCE &&
    dy < DOUBLE_CLICK_DISTANCE
  ) {
    lastClickTime = 0;
    void performWindowAction("maximize");
    return;
  }

  lastClickTime = now;
  lastClickX = event.clientX;
  lastClickY = event.clientY;
  void startWindowDragging();
}
