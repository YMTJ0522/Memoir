import type { EditorView } from "@codemirror/view";

/**
 * Toolbar keyboard shortcuts. The handlers reuse the same command helpers as
 * the toolbar buttons so behavior and undo history stay identical.
 *
 * Bound here (rather than EditorPane) to keep all toolbar behavior in one
 * place: Mod-b bold, Mod-i italic, Mod-e inline code, Mod-Shift-x
 * strikethrough, Mod-Shift-h highlight, Mod-Shift-. quote, Mod-Shift-7/8/9
 * ordered / bullet / task lists, Mod-1..6 heading levels.
 */

import {
  toolbarBlockPrefix,
  toolbarHeading,
  toolbarInline,
} from "./toolbar-commands";

type KeyHandler = (view: EditorView) => boolean;

function runInline(format: Parameters<typeof toolbarInline>[1]): KeyHandler {
  return (view) => {
    toolbarInline(view, format);
    return true;
  };
}

function runPrefix(kind: Parameters<typeof toolbarBlockPrefix>[1]): KeyHandler {
  return (view) => {
    toolbarBlockPrefix(view, kind);
    return true;
  };
}

function runHeading(level: 1 | 2 | 3 | 4 | 5 | 6): KeyHandler {
  return (view) => {
    toolbarHeading(view, level);
    return true;
  };
}

export const toolbarKeymap: readonly { key: string; run: KeyHandler }[] = [
  { key: "Mod-b", run: runInline("bold") },
  { key: "Mod-i", run: runInline("italic") },
  { key: "Mod-e", run: runInline("code") },
  { key: "Mod-Shift-x", run: runInline("strikethrough") },
  { key: "Mod-Shift-h", run: runInline("highlight") },
  { key: "Mod-Shift-.", run: runPrefix("quote") },
  { key: "Mod-Shift-7", run: runPrefix("ordered") },
  { key: "Mod-Shift-8", run: runPrefix("bullet") },
  { key: "Mod-Shift-9", run: runPrefix("task") },
  { key: "Mod-1", run: runHeading(1) },
  { key: "Mod-2", run: runHeading(2) },
  { key: "Mod-3", run: runHeading(3) },
  { key: "Mod-4", run: runHeading(4) },
  { key: "Mod-5", run: runHeading(5) },
  { key: "Mod-6", run: runHeading(6) },
];
