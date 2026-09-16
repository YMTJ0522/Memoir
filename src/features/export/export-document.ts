import type { ExportFormat } from "../../gateways/contracts";
import { EXPORT_FILTERS } from "../../gateways/contracts";
import type { ExportPageMargin, ExportTemplate, ExportTemplateId } from "./export-options";
import { EXPORT_TEMPLATES, PAGE_MARGIN_CSS } from "./export-options";

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
 *
 * The stylesheet is the single source of truth for both the HTML export and
 * the PDF export (PDF renders this exact document inside a hidden iframe), so
 * keep the two visually identical. Avoid CSS features html2canvas cannot
 * paint reliably (e.g. color-mix, oklch, complex gradients).
 */
export function htmlDocument(
  title: string,
  bodyHtml: string,
  language: string,
  templateId: ExportTemplateId = "minimal",
  pageMargin: ExportPageMargin = "normal",
): string {
  const safeTitle = escapeHtml(title);
  const template: ExportTemplate = EXPORT_TEMPLATES[templateId] ?? EXPORT_TEMPLATES.minimal;
  const marginCss = PAGE_MARGIN_CSS[pageMargin] ?? PAGE_MARGIN_CSS.normal;
  // Drop leading h1s that duplicate the document title: notes usually open
  // with `# Title` (sometimes twice — a cover line then a body line), and the
  // template below already emits one. The frontmatter properties card (if
  // any) may sit before the heading, so locate the first h1 anywhere in the
  // body rather than assuming it is the first child; then remove it together
  // with any immediately-following h1 that repeats the same text.
  let cleanBody = bodyHtml;
  if (title) {
    const parsed = new DOMParser().parseFromString(bodyHtml, "text/html");
    // Drop the frontmatter properties card — it's editor metadata, not content.
    parsed.querySelectorAll("details.memoir-frontmatter-properties").forEach((node) => node.remove());
    // Drop code block header chrome (copy buttons, titles).
    parsed.querySelectorAll(".memoir-code-block-head").forEach((node) => node.remove());
    parsed.querySelectorAll(".memoir-code-copy").forEach((node) => node.remove());
    // Drop leading h1s that duplicate the document title.
    let heading = parsed.body.querySelector("h1");
    let removed = false;
    while (heading && (heading.textContent ?? "").trim() === title.trim()) {
      const next = heading.nextElementSibling;
      heading.remove();
      removed = true;
      heading = next && next.tagName === "H1" ? (next as HTMLHeadingElement) : null;
    }
    if (removed || bodyHtml !== parsed.body.innerHTML) cleanBody = parsed.body.innerHTML;
  }
  return `<!DOCTYPE html>
<html lang="${escapeAttr(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">
<style>
:root {
  color-scheme: light;
  --bg: #ffffff;
  --text: var(--export-text);
  --muted: var(--export-muted);
  --border: var(--export-border);
  --border-strong: var(--export-border-strong);
  --link: var(--export-text);
  --code-bg: var(--export-code-bg);
  --code-border: var(--export-border);
  --code-text: var(--export-code-text);
  --table-head-bg: var(--export-table-head-bg);
  --table-head-text: var(--export-table-head-text);
  --table-stripe: var(--export-table-stripe);
  ${Object.entries(template.cssVars)
    .map(([key, value]) => `${key}: ${value};`)
    .join("\n  ")}
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
@page { size: A4; margin: ${marginCss}; }
/* Pagination hints: keep headings with following content, avoid orphaned
   headings at page bottom, and keep tables/callouts/images intact when
   they fit on a page. The JS paginator in render-note-pdf.tsx enforces
   these as well; the CSS rules also help direct browser "Print to PDF". */
h1, h2, h3, h4, h5, h6 { page-break-after: avoid; break-after: avoid; }
h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p { page-break-before: avoid; break-before: avoid; }
table, pre, .memoir-code-block, aside[data-callout], blockquote, details, figure, img {
  page-break-inside: avoid; break-inside: avoid;
}
tr, li { page-break-inside: avoid; break-inside: avoid; }
p { orphans: 3; widows: 3; }
body {
  margin: 0 auto;
  max-width: 50rem;
  padding: 3rem 2.25rem;
  font-family: var(--export-font);
  font-size: var(--export-body-size);
  line-height: var(--export-line-height);
  color: var(--text);
  background: var(--bg);
  text-rendering: optimizeLegibility;
}
@media print {
  body { padding: 0; max-width: none; font-size: 12pt; line-height: 1.7; }
  h1, h2, h3, h4 { page-break-after: avoid; break-after: avoid; }
  pre, table, aside[data-callout], blockquote, img, .memoir-code-block { page-break-inside: avoid; break-inside: avoid; }
  a { color: #000000; }
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.35;
  margin: 1.6em 0 0.7em;
  color: var(--export-heading);
  font-weight: 700;
  letter-spacing: 0.01em;
}
/* Document title: centered, with a double rule underneath. */
body > h1:first-of-type {
  text-align: center;
  font-size: 2em;
  margin: 0 0 1.2em;
  padding-bottom: 0.55em;
  border-bottom: 3px double var(--export-heading);
}
h1 { font-size: 1.8em; }
h2 {
  font-size: 1.45em;
}
h3 { font-size: 1.2em; }
h4 { font-size: 1.05em; }
p { margin: 0.75em 0; text-align: justify; }
a { color: var(--link); text-decoration: none; border-bottom: 1px solid #9ca3af; }
a:hover { text-decoration: underline; }
a.wikilink { color: var(--muted); text-decoration: none; border-bottom: 1px dashed var(--border-strong); }
strong { font-weight: 600; }
del { color: var(--muted); }
mark { background: #fef3c7; border-radius: 3px; padding: 0 0.15em; }
code {
  font-family: var(--export-mono);
  font-size: 0.88em;
  background: var(--export-code-bg);
  border-radius: 4px;
  padding: 0.15em 0.35em;
}
pre {
  background: var(--code-bg);
  color: var(--code-text);
  border-radius: 10px;
  padding: 1em 1.15em;
  overflow-x: auto;
  line-height: 1.65;
  margin: 1em 0;
  font-size: 0.875em;
}
pre code { background: transparent; padding: 0; color: inherit; }
/* Enhanced code fences (toolbar 增强代码块) render a header bar + inner pre. */
div.memoir-code-block {
  margin: 1.1em 0;
  border: 1px solid var(--code-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--code-bg);
}
div.memoir-code-block pre.memoir-code-pre {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
div.memoir-code-block pre.memoir-code-pre > code { display: block; background: transparent; }
.memoir-code-block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: #ececec;
  color: #4b5563;
  font-size: 12px;
  border-bottom: 1px solid var(--code-border);
}
.memoir-code-title { font-weight: 600; color: #1f2937; }
.memoir-code-lang { text-transform: uppercase; letter-spacing: 0.05em; }
/* The copy button has no behaviour in a static export — hide it. */
.memoir-code-copy { display: none; }
/* Code highlighting palette (GitHub light), kept in sync with preview.css. */
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-meta .hljs-keyword { color: #cf222e; }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-meta-string { color: #0a3069; }
.hljs-number, .hljs-literal, .hljs-symbol { color: #0550ae; }
.hljs-title, .hljs-title.function_, .hljs-section { color: #8250df; }
.hljs-type, .hljs-class .hljs-title, .hljs-title.class_ { color: #953800; }
.hljs-attr, .hljs-attribute, .hljs-name, .hljs-selector-class, .hljs-selector-id,
.hljs-selector-attr, .hljs-property { color: #116329; }
.hljs-comment, .hljs-quote, .hljs-doctag { color: #6e7781; font-style: italic; }
.hljs-variable, .hljs-template-variable, .hljs-params, .hljs-bullet,
.hljs-operator, .hljs-punctuation { color: #1f2328; }
.hljs-deletion { color: #82071e; }
blockquote {
  margin: 1.1em 0;
  padding: 0.7em 1.2em;
  border-left: 4px solid var(--export-blockquote-border);
  background: var(--export-blockquote-bg);
  border-radius: 0 8px 8px 0;
  color: var(--muted);
}
img { max-width: 100%; height: auto; border-radius: 8px; }
hr {
  border: none;
  height: 1px;
  background: var(--border-strong);
  margin: 1.8em 0;
}
table {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  margin: 1.1em 0;
  font-size: 0.95em;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  overflow: hidden;
}
th, td {
  border-bottom: 1px solid var(--border);
  padding: 0.55em 0.85em;
  text-align: left;
  vertical-align: top;
}
thead th {
  background: var(--table-head-bg);
  color: var(--table-head-text);
  font-weight: 600;
  border-bottom: none;
}
tr:last-child td { border-bottom: none; }
tbody tr:nth-child(even) { background: var(--table-stripe); }
ul, ol { padding-left: 1.7em; }
li { margin: 0.3em 0; }
li > p { margin: 0.2em 0; }
li.task-list-item { list-style: none; }
li.task-list-item input[type="checkbox"] { margin-right: 0.45em; transform: translateY(1px); }
details {
  margin: 1.1em 0;
  padding: 0.75em 1.05em;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--export-callout-bg);
}
summary { cursor: pointer; font-weight: 600; }
details[open] summary { margin-bottom: 0.45em; }
/* Frontmatter properties card (title / tags / date). */
details.memoir-frontmatter-properties { background: var(--export-callout-bg); border-color: var(--border-strong); }
details.memoir-frontmatter-properties > summary { color: var(--export-heading); font-size: 0.95em; }
.memoir-frontmatter-row { display: flex; gap: 0.6em; }
.memoir-frontmatter-row dt { min-width: 5em; color: var(--muted); }
.memoir-frontmatter-chip { display: inline-block; background: var(--bg); border: 1px solid var(--border); border-radius: 999px; padding: 0.05em 0.6em; margin: 0.1em 0.2em 0.1em 0; font-size: 0.9em; }
/* Callouts render as <aside data-callout="…"> in the preview pipeline.
   Black-and-white: a neutral gray accent + light gray tint for every type. */
aside[data-callout] {
  margin: 1.1em 0;
  padding: 0.85em 1.1em;
  border-radius: 10px;
  border-left: 4px solid var(--export-callout-border);
  background: var(--export-callout-bg);
}
aside[data-callout] > strong { display: block; margin-bottom: 0.3em; font-size: 0.95em; }
aside[data-callout] > div > :first-child { margin-top: 0; }
aside[data-callout] > div > :last-child { margin-bottom: 0; }
aside[data-callout="warning"] { border-color: var(--border-strong); background: #f9fafb; }
aside[data-callout="danger"], aside[data-callout="error"] { border-color: var(--border-strong); background: #f9fafb; }
aside[data-callout="success"], aside[data-callout="tip"] { border-color: var(--border-strong); background: #f9fafb; }
aside[data-callout="info"], aside[data-callout="note"] { border-color: var(--border-strong); background: #f9fafb; }
.footnote-ref { font-size: 0.8em; }
.footnotes { font-size: 0.9em; color: var(--muted); border-top: 1px solid var(--border); margin-top: 1.5em; padding-top: 0.75em; }
kbd {
  background: var(--export-code-bg);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0.08em 0.35em;
  font-family: var(--export-mono);
  font-size: 0.85em;
}
sub, sup { line-height: 0; }
.inline-tag {
  color: var(--text);
  background: var(--export-code-bg);
  border: 1px solid var(--border);
  padding: 0.06em 0.4em;
  border-radius: 999px;
  font-size: 0.9em;
  white-space: nowrap;
}
a.block-reference {
  color: var(--link);
  text-decoration: none;
  border-bottom: 1px dashed var(--border-strong);
}
.memoir-wiki-embed {
  display: block;
  margin: 1.2em 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--export-callout-bg);
  padding: 0.2em 1em;
}</style>
</head>
<body>
${safeTitle ? `<h1>${safeTitle}</h1>` : ""}
${cleanBody}
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
      note: { border: "#6b7280", background: "#f9fafb" },
      tip: { border: "#6b7280", background: "#f9fafb" },
      success: { border: "#6b7280", background: "#f9fafb" },
      warning: { border: "#6b7280", background: "#f9fafb" },
      danger: { border: "#6b7280", background: "#f9fafb" },
      error: { border: "#6b7280", background: "#f9fafb" },
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
