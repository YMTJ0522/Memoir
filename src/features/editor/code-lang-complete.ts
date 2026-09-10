import { Prec, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { fencedCodeLanguages } from "./code-languages";

/**
 * Code-fence language completion. Typing "```" at the start of a fence line
 * shows a list of the supported languages; ArrowUp/ArrowDown move, Enter or
 * Tab accepts, Esc cancels. Mirrors the wiki-link completion widget.
 */

type CodeLangQuery = { from: number; to: number; query: string; index: number };

const setLangIndex = StateEffect.define<number>();

class CodeLangWidget extends WidgetType {
  constructor(
    readonly options: string[],
    readonly active: number,
    readonly from: number,
    readonly to: number,
    readonly query: string,
  ) {
    super();
  }

  eq(other: CodeLangWidget) {
    return (
      this.active === other.active &&
      this.from === other.from &&
      this.to === other.to &&
      this.query === other.query &&
      this.options.length === other.options.length &&
      this.options.every((name, index) => name === other.options[index])
    );
  }

  ignoreEvent() {
    return true;
  }

  toDOM(view: EditorView) {
    const root = document.createElement("div");
    root.className = "wiki-complete";
    root.setAttribute("role", "listbox");
    this.options.forEach((name, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.tabIndex = -1;
      option.className = `wiki-complete-option${index === this.active ? " is-active" : ""}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === this.active ? "true" : "false");
      const label = document.createElement("span");
      label.className = "wiki-complete-title";
      label.textContent = name;
      option.append(label);
      option.addEventListener("mouseenter", () => {
        if (index === this.active) return;
        view.dispatch({ effects: setLangIndex.of(index) });
      });
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        insertCodeLanguage(view, this.from, this.to, name);
      });
      root.append(option);
    });
      root.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    return root;
  }
}

/** All supported fence language tokens (name + aliases), display order. */
const CODE_LANGUAGE_TOKENS: string[] = fencedCodeLanguages.flatMap((language) => [
  ...language.alias,
]);

export function codeLanguageTokens() {
  return CODE_LANGUAGE_TOKENS;
}

/** Detects an active "```query" completion context before `pos`. */
export function codeLangQueryAt(doc: string, pos: number): CodeLangQuery | null {
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const lineStart = clamped === 0 ? 0 : doc.lastIndexOf("\n", clamped - 1) + 1;
  const lineEnd = doc.indexOf("\n", lineStart);
  const line = doc.slice(lineStart, lineEnd < 0 ? doc.length : lineEnd);
  const localPos = clamped - lineStart;
  const match = /^(`{3,})([a-zA-Z0-9+#-]*)$/.exec(line.slice(0, localPos));
  if (!match) return null;
  return {
    from: lineStart + (match[1]?.length ?? 0),
    to: clamped,
    query: match[2] ?? "",
    index: 0,
  };
}

function codeLangQueryAtState(state: {
  doc: { length: number; toString(): string };
  selection: { main: { head: number } };
}) {
  return codeLangQueryAt(state.doc.toString(), state.selection.main.head);
}

const codeLangComplete = StateField.define<CodeLangQuery | null>({
  create(state) {
    return codeLangQueryAtState(state);
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLangIndex) && value) {
        return { ...value, index: effect.value };
      }
    }
    if (!transaction.docChanged && !transaction.selection) return value;
    const next = codeLangQueryAtState(transaction.state);
    if (!next) return null;
    if (value && next.from === value.from && next.query === value.query) {
      return { ...next, index: value.index };
    }
    return next;
  },
});

function filteredLanguages(query: string) {
  const needle = query.trim().toLowerCase();
  const all = CODE_LANGUAGE_TOKENS;
  if (!needle) return all.slice(0, 8);
  return all.filter((token) => token.toLowerCase().startsWith(needle)).slice(0, 8);
}

function insertCodeLanguage(view: EditorView, from: number, to: number, name: string) {
  view.dispatch({
    changes: { from, to, insert: name },
    selection: { anchor: from + name.length },
    userEvent: "input.complete",
  });
  view.focus();
}

const codeLangHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const query = view.state.field(codeLangComplete);
      if (!query) return Decoration.none;
      const options = filteredLanguages(query.query);
      if (!options.length) return Decoration.none;
      const index = ((query.index % options.length) + options.length) % options.length;
      return Decoration.set([
        Decoration.widget({
          block: false,
          side: 1,
          widget: new CodeLangWidget(options, index, query.from, query.to, query.query),
        }).range(query.to),
      ]);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function activeCompletion(view: EditorView) {
  const query = view.state.field(codeLangComplete);
  if (!query) return null;
  const options = filteredLanguages(query.query);
  if (!options.length) return null;
  const index = ((query.index % options.length) + options.length) % options.length;
  return { query, options, index };
}

function moveCompletion(view: EditorView, delta: number) {
  const active = activeCompletion(view);
  if (!active) return false;
  view.dispatch({
    effects: setLangIndex.of((active.index + delta + active.options.length) % active.options.length),
  });
  return true;
}

function acceptCompletion(view: EditorView) {
  const active = activeCompletion(view);
  if (!active) return false;
  const name = active.options[active.index];
  if (!name) return false;
  insertCodeLanguage(view, active.query.from, active.query.to, name);
  return true;
}

/** Editor extension: fence language completion popup + key handling. */
export function codeLangCompleteExtensions() {
  return [
    codeLangComplete,
    codeLangHighlight,
    Prec.highest(
      keymap.of([
        { key: "ArrowDown", run: (view) => moveCompletion(view, 1) },
        { key: "ArrowUp", run: (view) => moveCompletion(view, -1) },
        { key: "Enter", run: acceptCompletion },
        { key: "Tab", run: acceptCompletion },
      ]),
    ),
  ];
}
