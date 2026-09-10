import type { ChangeSpec } from "@codemirror/state";

/**
 * Toolbar markdown commands for the source editor.
 *
 * All transforms are pure (doc, selection) -> {change, selection} helpers so
 * they can be unit tested with plain strings, no CodeMirror mounting needed.
 * Selection positions in the result are in post-change coordinates, matching
 * the CM6 TransactionSpec.selection contract ({anchor, head?}).
 *
 * Behavior parity notes (mirrors the inkstone reference implementation):
 * - inline wraps toggle by removing surrounding marks or unwrapping contained
 *   ones; an empty selection expands to the word under the cursor, and an
 *   empty pair is inserted when no word exists (no placeholder text);
 * - italic uses a single `*` and toggles by asterisk-run parity;
 * - block toggles contract the selection when it ends at a line start;
 * - toggle selections are mapped through the applied changes (assoc +1).
 */

export type MarkdownCommandResult = {
  change: ChangeSpec;
  /** Selection after the change (post-change coordinates). */
  selection: { anchor: number; head?: number };
};

export type InlineFormat =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "highlight"
  | "inlineMath";

export const INLINE_MARKS: Record<InlineFormat, string> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  code: "`",
  highlight: "==",
  inlineMath: "$",
};

export type BlockKind = "quote" | "bullet" | "ordered" | "task";

/** Matches the prefix of the target block kind (after the line indent). */
const BLOCK_KIND_PATTERNS: Record<BlockKind, RegExp> = {
  quote: /^>\s?/,
  bullet: /^[-*+][ \t]+(?!\[[ xX]\][ \t]+)/,
  ordered: /^\d+[.)][ \t]+(?!\[[ xX]\][ \t]+)/,
  task: /^(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]+/,
};

/** Matches any other list-ish prefix so switching kinds replaces it. */
const ANY_LIST_PREFIX = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;

const BLOCK_KIND_PREFIXES: Record<BlockKind, string> = {
  quote: "> ",
  bullet: "- ",
  ordered: "",
  task: "- [ ] ",
};

const HEADING_PATTERN = /^(#{1,6})\s+/;

/** Expands an empty selection to the word (CJK-aware) around the cursor. */
function expandWordSelection(doc: string, from: number, to: number) {
  if (from !== to) return { from, to };
  const isWord = (character: string) => /[\p{L}\p{N}_]/u.test(character);
  let wordFrom = from;
  let wordTo = to;
  while (wordFrom > 0 && isWord(doc[wordFrom - 1] ?? "")) wordFrom -= 1;
  while (wordTo < doc.length && isWord(doc[wordTo] ?? "")) wordTo += 1;
  if (wordFrom === wordTo) return { from, to };
  return { from: wordFrom, to: wordTo };
}

/** Run of `character` ending just before `position` (document-wide). */
function characterRunBefore(doc: string, position: number, character: string): number {
  let count = 0;
  while (position - count - 1 >= 0 && doc[position - count - 1] === character) count += 1;
  return count;
}

/** Run of `character` starting exactly at `position` (document-wide). */
function characterRunAfter(doc: string, position: number, character: string): number {
  let count = 0;
  while (position + count < doc.length && doc[position + count] === character) count += 1;
  return count;
}

function leadingCharacterRun(value: string, character: string): number {
  let count = 0;
  while (count < value.length && value[count] === character) count += 1;
  return count;
}

function trailingCharacterRun(value: string, character: string): number {
  let count = 0;
  while (count < value.length && value[value.length - 1 - count] === character) count += 1;
  return count;
}

/** Longest run of a single character inside a string (fence sizing). */
function longestCharacterRun(value: string, character: string): number {
  let longest = 0;
  let current = 0;
  for (const valueCharacter of value) {
    current = valueCharacter === character ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * Line bounds covering the selection. When a non-empty selection ends at a
 * line start the last line is contracted (inkstone selectedLineBounds), so
 * block toggles never touch the line after the selection.
 */
function selectedLineBounds(doc: string, from: number, to: number) {
  const start = doc.lastIndexOf("\n", from - 1) + 1;
  const nextNewline = doc.indexOf("\n", to);
  let end = nextNewline < 0 ? doc.length : nextNewline;
  const lineStartAtTo = doc.lastIndexOf("\n", Math.max(0, to - 1)) + 1;
  if (from !== to && to > 0 && to === lineStartAtTo) {
    end = to - 1;
  }
  return { start, end };
}

function lineIndent(line: string): string {
  return line.match(/^[ \t]*/)?.[0] ?? "";
}

type PendingChange = { from: number; to?: number; insert?: string };

/**
 * Maps a position through the pending changes with CM's mapPos(pos, +1)
 * semantics: positions inside a replaced range move to its end.
 */
function mapPosition(position: number, changes: PendingChange[]): number {
  let delta = 0;
  for (const change of changes) {
    const from = change.from;
    const to = change.to ?? change.from;
    const length = change.insert?.length ?? 0;
    if (position < from) break;
    if (position <= to) {
      return to + delta + length;
    }
    delta += length - (to - from);
  }
  return position + delta;
}

function mappedSelection(selection: { from: number; to: number }, changes: PendingChange[]) {
  const anchor = mapPosition(selection.from, changes);
  const head = mapPosition(selection.to, changes);
  return anchor === head ? { anchor } : { anchor, head };
}

/**
 * Toggles a paired wrap (open/close may differ, e.g. `[[`/`]]`) with inkstone
 * semantics: surrounding marks are removed (selection kept), contained marks
 * are unwrapped, otherwise the selection is wrapped. An empty selection
 * expands to the word under the cursor first; without a word an empty pair
 * is inserted with the cursor between the marks.
 */
export function toggleWrap(
  doc: string,
  selection: { from: number; to: number },
  open: string,
  close = open,
): MarkdownCommandResult {
  const italicParity = open === "*" && close === "*";
  if (italicParity) {
    // Italic toggles by asterisk-run parity so `***text***` peels one `*`.
    const runBefore = characterRunBefore(doc, selection.from, "*");
    const runAfter = characterRunAfter(doc, selection.to, "*");
    if (runBefore % 2 === 1 && runAfter % 2 === 1) {
      return {
        change: [
          { from: selection.from - 1, to: selection.from },
          { from: selection.to, to: selection.to + 1 },
        ],
        selection: { anchor: selection.from - 1, head: selection.to - 1 },
      };
    }
  } else if (
    doc.slice(Math.max(0, selection.from - open.length), selection.from) === open &&
    doc.slice(selection.to, Math.min(doc.length, selection.to + close.length)) === close
  ) {
    return {
      change: [
        { from: selection.from - open.length, to: selection.from },
        { from: selection.to, to: selection.to + close.length },
      ],
      selection: {
        anchor: selection.from - open.length,
        head: selection.to - open.length,
      },
    };
  }
  const expanded = expandWordSelection(doc, selection.from, selection.to);
  const selected = doc.slice(expanded.from, expanded.to);
  const contained = (() => {
    if (italicParity) {
      const lead = leadingCharacterRun(selected, "*");
      const trail = trailingCharacterRun(selected, "*");
      return lead % 2 === 1 && trail % 2 === 1 && selected.length > 2
        ? { open: 1, close: 1 }
        : null;
    }
    return selected.startsWith(open) &&
      selected.endsWith(close) &&
      selected.length > open.length + close.length
      ? { open: open.length, close: close.length }
      : null;
  })();
  if (contained) {
    const inner = selected.slice(contained.open, selected.length - contained.close);
    return {
      change: { from: expanded.from, to: expanded.to, insert: inner },
      selection: { anchor: expanded.from, head: expanded.from + inner.length },
    };
  }
  const insert = `${open}${selected}${close}`;
  return {
    change: { from: expanded.from, to: expanded.to, insert },
    selection: selected
      ? {
          anchor: expanded.from + open.length,
          head: expanded.from + open.length + selected.length,
        }
      : { anchor: expanded.from + open.length },
  };
}

/** Toggles one of the toolbar inline formats (bold / italic / …). */
export function toggleInlineFormat(
  doc: string,
  selection: { from: number; to: number },
  format: InlineFormat,
): MarkdownCommandResult {
  return toggleWrap(doc, selection, INLINE_MARKS[format]);
}

/**
 * Toggles an inline code span with inkstone semantics: contained spans are
 * unwrapped (padding spaces stripped), surrounding equal backtick runs are
 * removed, otherwise the selection is wrapped with a CommonMark-safe fence
 * (padded when the text touches whitespace or backticks).
 */
export function toggleInlineCodeSpan(
  doc: string,
  selection: { from: number; to: number },
): MarkdownCommandResult {
  const expanded = expandWordSelection(doc, selection.from, selection.to);
  const selected = doc.slice(expanded.from, expanded.to);
  const spanFence = (() => {
    const lead = leadingCharacterRun(selected, "`");
    const trail = trailingCharacterRun(selected, "`");
    return lead > 0 && lead === trail && selected.length > lead * 2 ? lead : 0;
  })();
  if (spanFence > 0) {
    let content = selected.slice(spanFence, selected.length - spanFence);
    if (content.startsWith(" ") && content.endsWith(" ") && /\S/.test(content)) {
      content = content.slice(1, -1);
    }
    return {
      change: { from: expanded.from, to: expanded.to, insert: content },
      selection: { anchor: expanded.from, head: expanded.from + content.length },
    };
  }
  const runBefore = characterRunBefore(doc, expanded.from, "`");
  const runAfter = characterRunAfter(doc, expanded.to, "`");
  if (runBefore > 0 && runBefore === runAfter) {
    return {
      change: [
        { from: expanded.from - runBefore, to: expanded.from },
        { from: expanded.to, to: expanded.to + runAfter },
      ],
      selection: { anchor: expanded.from - runBefore, head: expanded.to - runBefore },
    };
  }
  const fence = "`".repeat(Math.max(1, longestCharacterRun(selected, "`") + 1));
  const pad = selected && /^(?:\s|`)|(?:\s|`)$/.test(selected) ? " " : "";
  const insert = `${fence}${pad}${selected}${pad}${fence}`;
  const anchor = expanded.from + fence.length + pad.length;
  return {
    change: { from: expanded.from, to: expanded.to, insert },
    selection: selected
      ? { anchor, head: anchor + selected.length }
      : { anchor: expanded.from + fence.length },
  };
}

/**
 * Toggles a block prefix (quote / bullet / ordered / task) over the selected
 * lines with inkstone semantics: lines already using the kind lose the
 * prefix when every touched line has it and stay untouched otherwise; other
 * list-ish prefixes are replaced; plain lines gain the prefix. Ordered
 * markers count every touched line (1-based).
 */
export function toggleBlockPrefix(
  doc: string,
  selection: { from: number; to: number },
  kind: BlockKind,
): MarkdownCommandResult {
  const { start, end } = selectedLineBounds(doc, selection.from, selection.to);
  const lines = doc.slice(start, end).split("\n");
  const pattern = BLOCK_KIND_PATTERNS[kind];
  const allPrefixed = lines.every((line) => pattern.test(line.slice(lineIndent(line).length)));
  const changes: PendingChange[] = [];
  let index = 0;
  let offset = start;
  for (const line of lines) {
    const indent = lineIndent(line);
    const body = line.slice(indent.length);
    const match = pattern.exec(body);
    const replacement = kind === "quote" ? null : ANY_LIST_PREFIX.exec(body);
    if (allPrefixed && match) {
      changes.push({ from: offset + indent.length, to: offset + indent.length + match[0].length });
    } else if (!match) {
      const prefix = kind === "ordered" ? `${index + 1}. ` : BLOCK_KIND_PREFIXES[kind];
      changes.push({
        from: offset + indent.length,
        to: replacement
          ? offset + indent.length + replacement[0].length
          : offset + indent.length,
        insert: prefix,
      });
    }
    offset += line.length + 1;
    index += 1;
  }
  return { change: changes as ChangeSpec[], selection: mappedSelection(selection, changes) };
}

/**
 * Sets or clears the ATX heading level on every selected line (inkstone
 * setHeading): the current level clears, another level replaces, plain lines
 * gain the marker at the line start.
 */
export function toggleHeadingLevel(
  doc: string,
  selection: { from: number; to: number },
  level: 1 | 2 | 3 | 4 | 5 | 6,
): MarkdownCommandResult {
  const { start, end } = selectedLineBounds(doc, selection.from, selection.to);
  const lines = doc.slice(start, end).split("\n");
  const marker = "#".repeat(level);
  const changes: PendingChange[] = [];
  let offset = start;
  for (const line of lines) {
    const match = HEADING_PATTERN.exec(line);
    if (match && match[1]?.length === level) {
      changes.push({ from: offset, to: offset + match[0].length });
    } else if (match) {
      changes.push({ from: offset, to: offset + match[0].length, insert: `${marker} ` });
    } else {
      changes.push({ from: offset, insert: `${marker} ` });
    }
    offset += line.length + 1;
  }
  return { change: changes as ChangeSpec[], selection: mappedSelection(selection, changes) };
}

/** Escapes the label part of a markdown link (`[` `]` and `\`). */
function escapeLinkLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/[\[\]]/g, "\\$&");
}

/** Wraps control characters / angle brackets into URL-safe escapes. */
function escapeLinkDestination(url: string): string {
  return url.replace(/[\u0000-\u0020<>]/g, (value) => encodeURIComponent(value));
}

/**
 * Inserts `[label](url)`. Selected text becomes the (escaped) label; the
 * cursor lands just before the closing `)` so typing the url is instant.
 */
export function insertLinkCommand(
  doc: string,
  selection: { from: number; to: number },
  url = "",
): MarkdownCommandResult {
  const text = doc.slice(selection.from, selection.to);
  const label = escapeLinkLabel(text);
  const destination = url ? `<${escapeLinkDestination(url)}>` : "";
  const insert = `[${label}](${destination})`;
  return {
    change: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + (text ? insert.length - 1 : 1) },
  };
}

/** Inserts `![alt](url)` with the same semantics as insertLinkCommand. */
export function insertImageCommand(
  doc: string,
  selection: { from: number; to: number },
  url = "",
): MarkdownCommandResult {
  const alt = escapeLinkLabel(doc.slice(selection.from, selection.to));
  const destination = url ? `<${escapeLinkDestination(url)}>` : "";
  const insert = `![${alt}](${destination})`;
  return {
    change: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + (alt ? insert.length - 1 : 2) },
  };
}

/**
 * Replaces the selection with `text` and places the cursor cursorOffset into
 * it (inkstone insertText, used for the math block button).
 */
export function insertTextCommand(
  selection: { from: number; to: number },
  text: string,
  cursorOffset: number,
): MarkdownCommandResult {
  return {
    change: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + cursorOffset },
  };
}

/**
 * Inserts `#` before the selection without consuming it (inkstone
 * insertPrefix); the selection shifts right by one.
 */
export function insertTagCommand(
  selection: { from: number; to: number },
): MarkdownCommandResult {
  return {
    change: { from: selection.from, insert: "#" },
    selection: selection.from === selection.to
      ? { anchor: selection.from + 1 }
      : { anchor: selection.from + 1, head: selection.to + 1 },
  };
}

/**
 * Inserts `^` at the cursor to start a block id. When the character before
 * the cursor is not whitespace a separating space is added first.
 */
export function insertBlockIdCommand(
  doc: string,
  selection: { from: number; to: number },
): MarkdownCommandResult {
  const at = selection.to;
  const prefix = at > 0 && !/\s/.test(doc[at - 1] ?? "") ? " " : "";
  const insert = `${prefix}^`;
  return {
    change: { from: at, to: at, insert },
    selection: { anchor: at + insert.length },
  };
}

/**
 * Inserts a footnote reference at the selection end and its definition at
 * the document tail; the cursor jumps to the definition.
 */
export function insertFootnoteCommand(
  doc: string,
  selection: { from: number; to: number },
): MarkdownCommandResult {
  let number = 1;
  while (doc.includes(`[^${number}]`)) number += 1;
  const reference = `[^${number}]`;
  const separator =
    doc.length === 0
      ? "\n\n"
      : doc.endsWith("\n\n")
        ? ""
        : doc.endsWith("\n")
          ? "\n"
          : "\n\n";
  const definition = `${separator}[^${number}]: `;
  const at = selection.to;
  const changes: ChangeSpec[] = [
    { from: at, insert: reference },
    { from: doc.length, to: doc.length, insert: definition },
  ];
  const definitionStart =
    doc.length + definition.length + (at === doc.length ? reference.length : 0);
  return { change: changes, selection: { anchor: definitionStart } };
}

/**
 * Inserts a `[!NOTE]` callout around the selection; every selected line is
 * quoted with `> `. The cursor lands after the inserted block.
 */
export function insertCalloutCommand(
  doc: string,
  selection: { from: number; to: number },
): MarkdownCommandResult {
  const selected = doc.slice(selection.from, selection.to);
  const body = selected
    ? selected.split("\n").map((line) => `> ${line}`).join("\n")
    : "> ";
  const insert = `> [!NOTE]\n${body}`;
  return {
    change: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length },
  };
}

/**
 * Inserts an open/close wrapped block (mermaid, details, …); selected text
 * becomes the content, otherwise the fallback is used and the cursor lands
 * emptyCursorOffset into the block.
 */
export function insertWrappedBlockCommand(
  doc: string,
  selection: { from: number; to: number },
  open: string,
  close: string,
  fallback: string,
  emptyCursorOffset?: number,
): MarkdownCommandResult {
  const selected = doc.slice(selection.from, selection.to);
  const content = selected || fallback;
  const insert = `${open}\n${content}\n${close}\n`;
  const cursor = selected
    ? selection.from + open.length + 1 + selected.length
    : selection.from + (emptyCursorOffset ?? open.length + 1);
  return {
    change: { from: selection.from, to: selection.to, insert },
    selection: { anchor: cursor },
  };
}

/**
 * Inserts a `:::: tabs` block with two `::: tab-item` children. Selected text
 * becomes the first tab's content and the cursor lands after it; with an
 * empty selection the first tab label is selected for immediate rename.
 */
export function insertTabsCommand(
  doc: string,
  selection: { from: number; to: number },
  firstLabel: string,
  secondLabel: string,
): MarkdownCommandResult {
  const selected = doc.slice(selection.from, selection.to);
  const firstContent = selected ? `\n${selected}` : "";
  const insert = `:::: tabs\n::: tab-item ${firstLabel}${firstContent}\n\n:::\n::: tab-item ${secondLabel}\n\n:::\n::::\n`;
  const anchor = selected
    ? selection.from + insert.indexOf(selected) + selected.length
    : selection.from + insert.indexOf(firstLabel);
  return {
    change: { from: selection.from, to: selection.to, insert },
    selection: selected
      ? { anchor }
      : { anchor, head: anchor + firstLabel.length },
  };
}

/**
 * Inserts a code fence sized after the longest backtick run in the selection
 * so the block stays valid. With an info string (enhanced code block) the
 * selection is kept; otherwise the cursor lands on the empty body line.
 */
export function insertCodeBlockCommand(
  doc: string,
  selection: { from: number; to: number },
  info = "",
): MarkdownCommandResult {
  const selected = doc.slice(selection.from, selection.to);
  const fence = "`".repeat(Math.max(3, longestCharacterRun(selected, "`") + 1));
  const insert = `${fence}${info}\n${selected}\n${fence}\n`;
  if (info && selected) {
    const anchor = selection.from + fence.length + info.length + 1;
    return {
      change: { from: selection.from, to: selection.to, insert },
      selection: { anchor, head: anchor + selected.length },
    };
  }
  return {
    change: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + fence.length },
  };
}

/**
 * Appends a block to the head line: when the line has content the snippet
 * starts on the next line, otherwise at the line end. Used by table and
 * horizontal rule inserts. The cursor lands cursorOffset inside the snippet.
 */
export function insertLineBlockCommand(
  doc: string,
  selection: { from: number; to: number; head?: number },
  text: string,
  cursorOffset: number,
): MarkdownCommandResult {
  const head = selection.head ?? selection.to;
  const lineStart = doc.lastIndexOf("\n", head - 1) + 1;
  let lineEnd = doc.indexOf("\n", head);
  if (lineEnd < 0) lineEnd = doc.length;
  const line = doc.slice(lineStart, lineEnd);
  const needsBreak = line.trim().length > 0;
  const insert = `${needsBreak ? "\n" : ""}${text}`;
  return {
    change: { from: lineEnd, to: lineEnd, insert },
    selection: { anchor: lineEnd + (needsBreak ? 1 : 0) + cursorOffset },
  };
}

/**
 * Inserts or jumps to front matter. Documents already starting with `---`
 * only move the cursor to the second line; others get a `---\ntitle: \n
 * tags: []\n---\n\n` header with the cursor after `title: `.
 */
export function insertFrontMatterCommand(
  doc: string,
): MarkdownCommandResult {
  if (/^---[ \t]*\r?\n/.test(doc)) {
    const firstLineEnd = doc.indexOf("\n") + 1;
    return { change: [], selection: { anchor: firstLineEnd } };
  }
  const insert = "---\ntitle: \ntags: []\n---\n\n";
  return {
    change: { from: 0, to: 0, insert },
    selection: { anchor: "---\ntitle: ".length },
  };
}
