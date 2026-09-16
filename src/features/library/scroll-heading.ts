import { EditorView } from "@codemirror/view";

const PREVIEW_SCROLL_SELECTOR = ".preview-pane";

/**
 * Scrolls to a heading in either preview mode (by element id) or editor mode
 * (by 1-based line number). Returns true when a scroll was performed.
 */
export function scrollHeadingInPreview(
  id: string,
  options?: { behavior?: ScrollBehavior; offset?: number; line?: number },
) {
  // ── Preview mode: find the rendered heading element inside .preview-pane ──
  const element = document.getElementById(id);
  if (element) {
    const container = element.closest<HTMLElement>(PREVIEW_SCROLL_SELECTOR);
    if (container) {
      const nextTop =
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        (options?.offset ?? 0);
      container.scrollTo({
        top: Math.max(0, nextTop),
        behavior: options?.behavior ?? "auto",
      });
      return true;
    }
  }

  // ── Editor mode: scroll the CodeMirror document to the heading line ───────
  if (options?.line) {
    const cmEl = document.querySelector<HTMLElement>(".memoir-cm-host .cm-editor");
    if (cmEl) {
      const view = EditorView.findFromDOM(cmEl);
      if (view) {
        const lineNo = Math.min(Math.max(1, options.line), view.state.doc.lines);
        const line = view.state.doc.line(lineNo);
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 24 }),
        });
        view.focus();
        return true;
      }
    }
  }

  return false;
}
