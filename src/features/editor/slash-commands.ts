import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Slash-command CodeMirror extension.
 *
 * Detects the "/" trigger at the start of a line (or after whitespace),
 * tracks the filter text as the user continues typing, and notifies React
 * via callbacks so it can render the menu overlay. Keyboard navigation
 * (ArrowUp / ArrowDown / Enter / Escape) is handled inside the extension.
 */

export type SlashCommandId =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "bulletList"
  | "numberedList"
  | "taskList"
  | "codeBlock"
  | "table"
  | "quote"
  | "divider"
  | "aiSummarize"
  | "aiOutline"
  | "aiContinue"
  | "aiTranslate";

/** Visible state pushed to React for rendering the menu overlay. */
export type SlashMenuRenderState = {
  open: boolean;
  /** Document position of the "/" character that opened the menu. */
  slashPos: number;
  /** Raw filter text typed between "/" and the cursor. */
  filter: string;
  /** Currently highlighted (zero-based) index across all visible items. */
  selectedIndex: number;
  /** Viewport (client) x of the cursor — used to position the menu. */
  x: number;
  /** Viewport (client) y of the cursor — used to position the menu. */
  y: number;
};

export type SlashCommandGroup = "formatting" | "ai";

export type SlashCommandItem = {
  id: SlashCommandId;
  group: SlashCommandGroup;
  /** i18n message key for the label. */
  labelKey: string;
};

/** All available slash commands, in display order. */
export const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: "heading1", group: "formatting", labelKey: "slash.heading1" },
  { id: "heading2", group: "formatting", labelKey: "slash.heading2" },
  { id: "heading3", group: "formatting", labelKey: "slash.heading3" },
  { id: "bold", group: "formatting", labelKey: "slash.bold" },
  { id: "italic", group: "formatting", labelKey: "slash.italic" },
  { id: "bulletList", group: "formatting", labelKey: "slash.bulletList" },
  { id: "numberedList", group: "formatting", labelKey: "slash.numberedList" },
  { id: "taskList", group: "formatting", labelKey: "slash.taskList" },
  { id: "codeBlock", group: "formatting", labelKey: "slash.codeBlock" },
  { id: "table", group: "formatting", labelKey: "slash.table" },
  { id: "quote", group: "formatting", labelKey: "slash.quote" },
  { id: "divider", group: "formatting", labelKey: "slash.divider" },
  { id: "aiSummarize", group: "ai", labelKey: "slash.aiSummarize" },
  { id: "aiOutline", group: "ai", labelKey: "slash.aiOutline" },
  { id: "aiContinue", group: "ai", labelKey: "slash.aiContinue" },
  { id: "aiTranslate", group: "ai", labelKey: "slash.aiTranslate" },
];

/** Returns the commands matching the (lower-cased) filter string. */
export function filterSlashCommands(filter: string): SlashCommandItem[] {
  const query = filter.trim().toLowerCase();
  if (!query) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) => cmd.labelKey.toLowerCase().includes(query));
}

type InternalState = {
  open: boolean;
  slashPos: number;
  selectedIndex: number;
};

export type SlashCommandCallbacks = {
  /** Called whenever the menu open/filter/selection state changes. */
  onStateChange: (state: SlashMenuRenderState | null) => void;
  /** Execute a formatting command (menu is closed by the caller). */
  onExecuteFormat: (id: SlashCommandId, view: EditorView) => void;
  /** Execute an AI command (menu is closed by the caller). */
  onExecuteAi: (id: SlashCommandId, view: EditorView) => Promise<void>;
};

/**
 * Heuristic: "/" only opens the menu when it's the first non-whitespace
 * character on its line (or the very first character of the document).
 */
function isSlashTriggerPosition(docText: string, slashPos: number): boolean {
  const lineStart = docText.lastIndexOf("\n", slashPos - 1) + 1;
  const between = docText.slice(lineStart, slashPos);
  return between.trim() === "";
}

/** True when the character at `pos` sits inside a fenced code block. */
function isInCodeBlock(view: EditorView, pos: number): boolean {
  // Heuristic: count ``` fences before pos. Inside a fence we don't trigger.
  const doc = view.state.doc.toString();
  const before = doc.slice(0, pos);
  const fenceMatches = before.match(/^```/gm);
  return (fenceMatches?.length ?? 0) % 2 === 1;
}

export function createSlashCommandsExtension(
  callbacks: SlashCommandCallbacks,
): Extension[] {
  const state: InternalState = { open: false, slashPos: 0, selectedIndex: 0 };

  function closeMenu(view: EditorView) {
    state.open = false;
    callbacks.onStateChange(null);
    void view;
  }

  function emitState(view: EditorView) {
    if (!state.open) return;
    const cursor = view.state.selection.main.head;
    const filter = view.state.sliceDoc(state.slashPos + 1, cursor);
    const filtered = filterSlashCommands(filter);
    const coords = view.coordsAtPos(cursor);
    callbacks.onStateChange({
      open: true,
      slashPos: state.slashPos,
      filter,
      selectedIndex: Math.min(state.selectedIndex, Math.max(0, filtered.length - 1)),
      x: coords?.left ?? 0,
      y: coords?.bottom ?? 0,
    });
  }

  function openMenu(view: EditorView, slashPos: number) {
    state.open = true;
    state.slashPos = slashPos;
    state.selectedIndex = 0;
    emitState(view);
  }

  function executeCurrent(view: EditorView) {
    if (!state.open) return;
    const cursor = view.state.selection.main.head;
    const filter = view.state.sliceDoc(state.slashPos + 1, cursor);
    const filtered = filterSlashCommands(filter);
    const item = filtered[state.selectedIndex];
    if (!item) {
      closeMenu(view);
      return;
    }
    // Remove the "/" and filter text first.
    view.dispatch({
      changes: { from: state.slashPos, to: cursor, insert: "" },
      selection: { anchor: state.slashPos },
      userEvent: "input.slash",
    });
    state.open = false;
    callbacks.onStateChange(null);

    if (item.group === "formatting") {
      callbacks.onExecuteFormat(item.id, view);
    } else {
      void callbacks.onExecuteAi(item.id, view);
    }
  }

  return [
    EditorView.updateListener.of((update) => {
      const view = update.view;
      const sel = view.state.selection.main;

      if (state.open) {
        // Menu is open — validate the cursor is still right after "/" + filter.
        if (!sel.empty) {
          closeMenu(view);
          return;
        }
        const between = view.state.sliceDoc(state.slashPos + 1, sel.head);
        // Any whitespace between "/" and cursor closes the menu.
        if (/\s/.test(between) || sel.head <= state.slashPos) {
          closeMenu(view);
          return;
        }
        emitState(view);
        return;
      }

      // Menu is closed — detect a freshly typed "/".
      if (!update.docChanged || !sel.empty) return;
      const cursor = sel.head;
      if (cursor < 1) return;
      const charBefore = view.state.sliceDoc(cursor - 1, cursor);
      if (charBefore !== "/") return;
      if (!isSlashTriggerPosition(view.state.doc.toString(), cursor - 1)) return;
      if (isInCodeBlock(view, cursor - 1)) return;
      openMenu(view, cursor - 1);
    }),
    keymap.of([
      {
        key: "ArrowDown",
        run: (view) => {
          if (!state.open) return false;
          const cursor = view.state.selection.main.head;
          const filter = view.state.sliceDoc(state.slashPos + 1, cursor);
          const filtered = filterSlashCommands(filter);
          state.selectedIndex = (state.selectedIndex + 1) % Math.max(1, filtered.length);
          emitState(view);
          return true;
        },
      },
      {
        key: "ArrowUp",
        run: (view) => {
          if (!state.open) return false;
          const cursor = view.state.selection.main.head;
          const filter = view.state.sliceDoc(state.slashPos + 1, cursor);
          const filtered = filterSlashCommands(filter);
          const count = Math.max(1, filtered.length);
          state.selectedIndex = (state.selectedIndex - 1 + count) % count;
          emitState(view);
          return true;
        },
      },
      {
        key: "Enter",
        run: (view) => {
          if (!state.open) return false;
          executeCurrent(view);
          return true;
        },
      },
      {
        key: "Escape",
        run: (view) => {
          if (!state.open) return false;
          closeMenu(view);
          return true;
        },
      },
    ]),
  ];
}
