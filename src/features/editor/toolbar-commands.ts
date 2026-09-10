import type { EditorView } from "@codemirror/view";
import {
  insertBlockIdCommand,
  insertCalloutCommand,
  insertCodeBlockCommand,
  insertFootnoteCommand,
  insertFrontMatterCommand,
  insertImageCommand,
  insertLinkCommand,
  insertLineBlockCommand,
  insertTabsCommand,
  insertTagCommand,
  insertTextCommand,
  insertWrappedBlockCommand,
  toggleBlockPrefix,
  toggleHeadingLevel,
  toggleInlineCodeSpan,
  toggleInlineFormat,
  toggleWrap,
  type MarkdownCommandResult,
} from "./markdown-commands";
import {
  ADVANCED_CODE_INFO,
  DETAILS_CLOSE,
  DETAILS_OPEN,
  HORIZONTAL_RULE_CURSOR_OFFSET,
  HORIZONTAL_RULE_SNIPPET,
  MATH_BLOCK_CURSOR_OFFSET,
  MATH_BLOCK_SNIPPET,
  MERMAID_FALLBACK,
} from "./markdown-snippets";

/**
 * View-level toolbar commands bridging markdown-commands.ts to CodeMirror.
 * Every command dispatches exactly one transaction (one undo step) and
 * refocuses the editor afterwards. Behavior parity notes mirror the
 * inkstone reference toolbar: 5 groups + 4 dropdown menus.
 */

/** Cursor offset of the `[]` inside the `::: details []` opener. */
const DETAILS_CURSOR_OFFSET = "::: details [".length;

function dispatchResult(view: EditorView, result: MarkdownCommandResult) {
  view.dispatch({
    changes: result.change,
    selection: result.selection,
    scrollIntoView: true,
    userEvent: "input.toolbar",
  });
  view.focus();
}

function doc(view: EditorView) {
  return view.state.doc.toString();
}

function selection(view: EditorView) {
  return view.state.selection.main;
}

/** Selection with head preserved (insertLineBlockCommand uses range.head). */
function headSelection(view: EditorView) {
  const range = view.state.selection.main;
  return { from: range.from, to: range.to, head: range.head };
}

export function toolbarInline(
  view: EditorView,
  format: Parameters<typeof toggleInlineFormat>[2],
) {
  dispatchResult(view, toggleInlineFormat(doc(view), selection(view), format));
}

/** Paired wraps beyond the inline marks: `[[ ]]`, `![[ ]]`, `[[#^ ]]`. */
export function toolbarWrap(view: EditorView, open: string, close = open) {
  dispatchResult(view, toggleWrap(doc(view), selection(view), open, close));
}

export function toolbarInlineCode(view: EditorView) {
  dispatchResult(view, toggleInlineCodeSpan(doc(view), selection(view)));
}

export function toolbarBlockPrefix(
  view: EditorView,
  kind: Parameters<typeof toggleBlockPrefix>[2],
) {
  dispatchResult(view, toggleBlockPrefix(doc(view), selection(view), kind));
}

export function toolbarHeading(view: EditorView, level: 1 | 2 | 3 | 4 | 5 | 6) {
  dispatchResult(view, toggleHeadingLevel(doc(view), selection(view), level));
}

export function toolbarLink(view: EditorView, url = "") {
  dispatchResult(view, insertLinkCommand(doc(view), selection(view), url));
}

export function toolbarImage(view: EditorView, url = "") {
  dispatchResult(view, insertImageCommand(doc(view), selection(view), url));
}

export function toolbarTag(view: EditorView) {
  dispatchResult(view, insertTagCommand(selection(view)));
}

export function toolbarBlockId(view: EditorView) {
  dispatchResult(view, insertBlockIdCommand(doc(view), selection(view)));
}

export function toolbarFootnote(view: EditorView) {
  dispatchResult(view, insertFootnoteCommand(doc(view), selection(view)));
}

export function toolbarCallout(view: EditorView) {
  dispatchResult(view, insertCalloutCommand(doc(view), selection(view)));
}

export function toolbarDetails(view: EditorView) {
  dispatchResult(
    view,
    insertWrappedBlockCommand(
      doc(view),
      selection(view),
      DETAILS_OPEN,
      DETAILS_CLOSE,
      "",
      DETAILS_CURSOR_OFFSET,
    ),
  );
}

export function toolbarTabs(view: EditorView, firstLabel: string, secondLabel: string) {
  dispatchResult(
    view,
    insertTabsCommand(doc(view), selection(view), firstLabel, secondLabel),
  );
}

export function toolbarMermaid(view: EditorView) {
  dispatchResult(
    view,
    insertWrappedBlockCommand(
      doc(view),
      selection(view),
      "```mermaid",
      "```",
      MERMAID_FALLBACK,
    ),
  );
}

export function toolbarCodeBlock(view: EditorView) {
  dispatchResult(view, insertCodeBlockCommand(doc(view), selection(view)));
}

export function toolbarAdvancedCodeBlock(view: EditorView) {
  dispatchResult(
    view,
    insertCodeBlockCommand(doc(view), selection(view), ADVANCED_CODE_INFO),
  );
}

export function toolbarTable(
  view: EditorView,
  headerRow: string,
  rows = 1,
  cols = 3,
) {
  // Column headers mirror the user locale; the data rows below keep the
  // inkstone placeholder form ("|  |  |  |" — one blank cell per column).
  const header = Array.from({ length: cols }, (_, index) => `| ${headerLabel(headerRow, index)}`);
  header.push("|");
  const delimiter = `|${" --- |".repeat(cols)}`;
  const dataRows = Array.from(
    { length: Math.max(1, rows - 1) },
    () => `|${"  |".repeat(cols)}`,
  );
  const template = [header.join(""), delimiter, ...dataRows, ""].join("\n");
  dispatchResult(view, insertLineBlockCommand(doc(view), headSelection(view), template, 2));
}

/** Indexes per-column labels out of the i18n header row like "| 列 1 | 列 2 |". */
function headerLabel(headerRow: string, index: number): string {
  const cells = headerRow.split("|").map((cell) => cell.trim());
  const label = cells[index + 1];
  return label || `Column ${index + 1}`;
}

export function toolbarHorizontalRule(view: EditorView) {
  dispatchResult(
    view,
    insertLineBlockCommand(
      doc(view),
      headSelection(view),
      HORIZONTAL_RULE_SNIPPET,
      HORIZONTAL_RULE_CURSOR_OFFSET,
    ),
  );
}

export function toolbarMathBlock(view: EditorView) {
  dispatchResult(
    view,
    insertTextCommand(selection(view), MATH_BLOCK_SNIPPET, MATH_BLOCK_CURSOR_OFFSET),
  );
}

export function toolbarFrontMatter(view: EditorView) {
  dispatchResult(view, insertFrontMatterCommand(doc(view)));
}
