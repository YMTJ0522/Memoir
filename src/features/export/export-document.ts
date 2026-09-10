import type { ExportFormat } from "../../gateways/contracts";
import { EXPORT_FILTERS } from "../../gateways/contracts";

/**
 * Shared helpers for the non-PDF export formats (Word / HTML / Markdown).
 * The self-contained HTML template mirrors inkstone's export-note.ts
 * htmlDocument(): inline CSS, KaTeX CDN link, print media rules.
 */

export function safeFileName(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function exportFileName(title: string, format: ExportFormat): string {
  const extension = EXPORT_FILTERS[format].extensions[0];
  return `${safeFileName(title) || "note"}.${extension}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

/** Markdown export mirrors inkstone: regenerate a title front matter block. */
export function markdownDocument(title: string, content: string): string {
  const trimmed = title.trim();
  const frontMatter = trimmed ? `---\ntitle: ${JSON.stringify(trimmed)}\n---\n\n` : "";
  return `${frontMatter}${content}`;
}

/**
 * Self-contained HTML document (inkstone parity). `bodyHtml` should already
 * be rendered HTML with images inlined as data URLs where possible.
 */
export function htmlDocument(title: string, bodyHtml: string, language: string): string {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="${escapeAttr(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
@page { size: A4; margin: 2.54cm; }
body { margin: 0 auto; max-width: 46rem; padding: 2.5rem 1.75rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.75; color: #1f2328; background: #fff; }
@media print {
  body { padding: 0; max-width: none; font-size: 12pt; line-height: 1.6; }
  h1, h2, h3 { page-break-after: avoid; }
  pre, table, .callout, blockquote, img { page-break-inside: avoid; }
  a { color: #1a5276; }
}
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.4em 0 0.6em; color: #1a5276; }
h1 { font-size: 1.75em; }
h2 { font-size: 1.4em; padding-bottom: 0.25em; border-bottom: 1px solid #e5e7eb; }
h3 { font-size: 1.18em; }
h4 { font-size: 1.05em; }
p { margin: 0.7em 0; text-align: justify; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
a.wikilink { color: #4b5563; text-decoration: none; border-bottom: 1px dashed #9ca3af; }
strong { font-weight: 600; }
del { color: #6b7280; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 0.88em; background: #f3f4f6; border-radius: 4px; padding: 0.15em 0.35em; }
pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 1em 1.1em; overflow-x: auto; line-height: 1.6; margin: 0.9em 0; }
pre code { background: transparent; padding: 0; font-size: 0.85em; color: inherit; }
blockquote { margin: 0.9em 0; padding: 0.2em 1.1em; border-left: 3px solid #d1d5db; color: #4b5563; }
img { max-width: 100%; height: auto; border-radius: 6px; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.6em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.9em 0; font-size: 0.95em; }
th, td { border: 1px solid #d1d5db; padding: 0.4em 0.7em; text-align: left; vertical-align: top; }
th { background: #f3f4f6; font-weight: 600; }
tr:nth-child(even) td { background: #f9fafb; }
ul, ol { padding-left: 1.6em; }
li { margin: 0.25em 0; }
li.task-list-item { list-style: none; }
input.task-list-item-checkbox { margin-right: 0.45em; transform: translateY(1px); }
details { margin: 0.9em 0; padding: 0.7em 1em; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; }
summary { cursor: pointer; font-weight: 600; }
details[open] summary { margin-bottom: 0.4em; }
.callout { border-left: 4px solid #6b7280; border-radius: 6px; padding: 0.65em 1em; margin: 0.9em 0; background: #f9fafb; }
.callout[data-callout="warning"] { border-color: #d97706; background: #fffbeb; }
.callout[data-callout="danger"], .callout[data-callout="error"] { border-color: #dc2626; background: #fef2f2; }
.callout[data-callout="success"], .callout[data-callout="tip"] { border-color: #16a34a; background: #f0fdf4; }
.callout[data-callout="info"], .callout[data-callout="note"] { border-color: #2563eb; background: #eff6ff; }
.callout-title { font-weight: 600; margin-bottom: 0.25em; }
.callout-content > :first-child { margin-top: 0; }
.callout-content > :last-child { margin-bottom: 0; }
.footnote-ref { font-size: 0.8em; }
.footnotes { font-size: 0.9em; color: #4b5563; border-top: 1px solid #e5e7eb; margin-top: 1.5em; padding-top: 0.75em; }
kbd { background: #f3f4f6; border: 1px solid #d1d5db; border-bottom-width: 2px; border-radius: 4px; padding: 0.08em 0.35em; font-family: ui-monospace, monospace; font-size: 0.85em; }
sub, sup { line-height: 0; }
</style>
</head>
<body>
${safeTitle ? `<h1>${safeTitle}</h1>` : ""}
${bodyHtml}
</body>
</html>`;
}

/**
 * Cleans rendered preview HTML for Word export. Word's HTML engine is far
 * cruder than a browser's, so preview-only artifacts must be dropped:
 * - the frontmatter properties card (`<details>`) is editor metadata,
 * - `data-source-line` and `data-*` attributes are scroll-sync helpers,
 * - `node="[object Object]"` attributes leak from ReactMarkdown internals,
 * - `hljs` code highlight spans add hundreds of meaningless classes,
 * - the body may already start with a heading duplicating the page title.
 * Word additionally renders `<li><p>…</p></li>` as two stacked lines and
 * `<span class="line">` code wrappers as extra breaks, so both are unwrapped
 * into the flat structures Word's list/pre engines expect.
 */
export function sanitizeBodyHtmlForWord(bodyHtml: string): string {
  const doc = new DOMParser().parseFromString(bodyHtml, "text/html");
  // Drop the frontmatter properties card; its title/tags are covered by the
  // document title and Word cannot render `details`/`dl` gracefully.
  doc.querySelectorAll("details.memoir-frontmatter-properties").forEach((node) => node.remove());
  // Strip the copy button and header chrome of enhanced code blocks, keeping
  // the code itself. Word renders unknown buttons as inline text.
  doc.querySelectorAll(".memoir-code-block-head").forEach((node) => node.remove());
  doc.querySelectorAll(".memoir-code-copy").forEach((node) => node.remove());
  // Unwrap `hljs` code highlight spans: Word ignores the styling but keeps
  // the deep nesting, which bloats the layout tree it has to interpret.
  doc.querySelectorAll("code span[class*='hljs']").forEach((node) => {
    const parent = node.parentNode;
    if (!parent) return;
    parent.replaceChild(doc.createTextNode(node.textContent ?? ""), node);
  });
  // Unwrap per-line `span.line` wrappers inside code blocks: they exist only
  // for line-number/highlight CSS and become blank lines in Word.
  doc.querySelectorAll("pre span.line").forEach((node) => {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  });
  // Lift the inner `<p>` out of every list item: Word stacks the marker and
  // the paragraph as two lines, which breaks list/TOC numbering.
  doc.querySelectorAll("li > p, li > div").forEach((paragraph) => {
    const parent = paragraph.parentNode;
    if (!parent) return;
    while (paragraph.firstChild) parent.insertBefore(paragraph.firstChild, paragraph);
    parent.removeChild(paragraph);
  });
  // Word's HTML engine does not understand `[data-*]` attribute selectors
  // or Tailwind utility classes, so callout styling (left accent border +
  // tinted background) would be lost. Inline the effective styles directly,
  // keyed off the `data-callout` type.
  doc.querySelectorAll("aside[data-callout]").forEach((node) => {
    const element = node as HTMLElement;
    const type = element.getAttribute("data-callout") ?? "note";
    const palette: Record<string, { border: string; background: string }> = {
      note: { border: "#2563eb", background: "#eff6ff" },
      tip: { border: "#16a34a", background: "#f0fdf4" },
      success: { border: "#16a34a", background: "#f0fdf4" },
      warning: { border: "#d97706", background: "#fffbeb" },
      danger: { border: "#dc2626", background: "#fef2f2" },
      error: { border: "#dc2626", background: "#fef2f2" },
    };
    const colors = palette[type] ?? palette.note!;
    element.style.borderLeft = `4pt solid ${colors.border}`;
    element.style.background = colors.background;
    element.style.padding = "6pt 10pt";
    element.style.margin = "8pt 0";
  });
  // Unwrap `<details>` blocks: Word renders unknown `details`/`summary` tags
  // as inline text with the content concatenated. Lift the summary out as a
  // bold paragraph and flatten the wrapper into plain block content.
  doc.querySelectorAll("details").forEach((node) => {
    const summary = node.querySelector(":scope > summary");
    if (summary) {
      const title = document.createElement("p");
      title.style.fontWeight = "bold";
      title.textContent = summary.textContent ?? "";
      summary.replaceWith(title);
    }
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  });
  // Continuous-space indentation inside `<pre>` must survive Word: it
  // collapses normal whitespace but honors non-breaking spaces in `pre`.
  doc.querySelectorAll("pre").forEach((pre) => {
    for (const text of [...pre.querySelectorAll("*"), pre].flatMap((node) =>
      [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE),
    )) {
      text.textContent = (text.textContent ?? "").replace(/ {2,}/g, (spaces) =>
        "\u00a0".repeat(spaces.length),
      );
    }
  });
  doc.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) element.removeAttribute(attribute.name);
      // ReactMarkdown passes its internal `node` prop through to the DOM,
      // which serializes as node="[object Object]" and confuses Word.
      if (attribute.name === "node" || attribute.value === "[object Object]") {
        element.removeAttribute(attribute.name);
      }
    }
  });
  // Remove a leading `h1` that repeats the document title (the export
  // template already emits one). Memoir's own notes open with `# Title`.
  const firstChild = doc.body.firstElementChild;
  if (firstChild?.tagName === "H1") firstChild.remove();
  return doc.body.innerHTML;
}

/**
 * Word-compatible HTML document. Word opens HTML with a `application/msword`
 * Word namespace declaration directly and keeps basic styling.
 */
export function wordDocument(title: string, bodyHtml: string, language: string): string {
  const safeTitle = escapeHtml(title);
  const cleanBody = sanitizeBodyHtmlForWord(bodyHtml);
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="${escapeAttr(language)}">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="Microsoft Word 15">
<title>${safeTitle}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page { size: A4; margin: 2.54cm; }
body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 12pt; line-height: 1.6; color: #1f2328; }
h1 { font-size: 20pt; }
h2 { font-size: 16pt; }
h3 { font-size: 14pt; }
h4, h5, h6 { font-size: 12pt; }
pre { background: #f3f4f6; border: 1px solid #d1d5db; padding: 8pt; font-family: Consolas, "Courier New", monospace; font-size: 10pt; white-space: pre-wrap; }
code { font-family: Consolas, "Courier New", monospace; background: #f3f4f6; }
blockquote { border-left: 3pt solid #d1d5db; margin-left: 0; padding-left: 10pt; color: #4b5563; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1pt solid #9ca3af; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
img { max-width: 100%; }
ul, ol { margin: 0.5em 0; padding-left: 1.6em; }
li { margin: 0.2em 0; }
</style>
</head>
<body>
${safeTitle ? `<h1>${safeTitle}</h1>` : ""}
${cleanBody}
</body>
</html>`;
}
