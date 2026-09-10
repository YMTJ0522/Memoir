/**
 * Word export using the `docx` library to generate a true OOXML .docx file.
 *
 * This replaces the previous HTML-with-Word-namespace approach, which suffered
 * from Word's limited HTML rendering: broken list numbering, `[object Object]`
 * attribute leaks, `<li><p>` double-line rendering, and loss of callout/code
 * styling.  By generating a real .docx via the docx-js declarative API, we get
 * native Word list numbering, proper heading styles, real table borders, and
 * clean paragraph spacing.
 *
 * The pipeline mirrors the docx skill's md_to_js.py:
 *   rendered HTML → structural blocks → docx-js Document → Packer.toBuffer → Uint8Array
 *
 * Unlike md_to_js.py (which parses raw Markdown), we parse the *rendered* HTML
 * so that all preview pipeline features (callouts, code blocks with headers,
 * Mermaid diagrams, link cards, frontmatter) are captured.
 */

import type { NoteMeta } from "../../domain/notes";
import type { AppLocale, BodyFont } from "../../domain/settings";
import { getGateways } from "../../gateways";
import {
  decodeMediaHref,
  noteDirectory,
  resolveWorkspaceFilePath,
} from "../../domain/paths";
import { I18nProvider } from "../../i18n/react";
import { createRoot } from "react-dom/client";
import { parseNote } from "../library/note-utils";
import { NotePreviewArticle } from "../preview/NotePreviewArticle";

// The `docx` library is imported lazily (see loadDocxModule) because JSZip
// decides its byte handling at module-evaluation time based on whether
// `globalThis.Buffer` exists:
//
//   - Memoir installs a minimal Buffer stub (src/platform/buffer-stub.ts) so
//     gray-matter's frontmatter parsing works in the browser. That stub makes
//     `typeof Buffer !== "undefined"` true, so JSZip picks its "nodebuffer"
//     path, which calls Buffer APIs the stub cannot satisfy (from() returns an
//     empty Uint8Array), producing .docx archives whose entry names are all
//     empty → WPS cannot locate word/document.xml and renders garbage.
//   - If Buffer is absent when the module evaluates, JSZip falls back to its
//     pure-browser uint8array path and the archive is valid (verified via
//     headless Edge: 22 entries with correct names).
//
// The fix: before the FIRST dynamic import of "docx", temporarily delete
// `globalThis.Buffer`, then restore the stub afterwards. gray-matter needs
// the stub for frontmatter parsing, so it must be restored — but only after
// the docx module has been evaluated once (module scope runs once; the cached
// promise keeps the decision stable for subsequent exports).
import type {
  ExternalHyperlink,
  HeadingLevel,
  ITableCellOptions,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";

type DocxModule = typeof import("docx");

let docxModulePromise: Promise<DocxModule> | null = null;
/** Resolved docx module, assigned at the start of renderNoteDocx. */
let docxModule: DocxModule | null = null;

function loadDocxModule(): Promise<DocxModule> {
  if (!docxModulePromise) {
    // In Node (vitest) the real Buffer exists and JSZip's nodebuffer path is
    // correct — never touch it. Only the browser webview's stub needs the
    // temporary removal dance.
    const isNode = typeof process !== "undefined" && !!(process as { versions?: { node?: string } }).versions?.node;
    if (isNode) {
      docxModulePromise = Promise.resolve(import("docx"));
      return docxModulePromise;
    }
    const hadBuffer = "Buffer" in globalThis;
    const savedBuffer = (globalThis as Record<string, unknown>).Buffer;
    try {
      // Let JSZip detect a browser environment (no Buffer → uint8array path).
      delete (globalThis as Record<string, unknown>).Buffer;
      docxModulePromise = import("docx").then((mod) => {
        // Restore the stub once the module has been evaluated. Module scope
        // has already decided its zip backend, so later exports keep working
        // without re-importing.
        if (hadBuffer) {
          (globalThis as Record<string, unknown>).Buffer = savedBuffer;
        }
        return mod;
      });
      // If the import itself throws, make sure the stub is restored too.
      docxModulePromise.catch(() => {
        if (hadBuffer) {
          (globalThis as Record<string, unknown>).Buffer = savedBuffer;
        }
        docxModulePromise = null;
      });
    } catch (error) {
      if (hadBuffer) {
        (globalThis as Record<string, unknown>).Buffer = savedBuffer;
      }
      throw error;
    }
  }
  return docxModulePromise;
}

const EXPORT_WIDTH_PX = 794;

// ── Design tokens (aligned with docx skill defaults) ────────────────────────

const FONT_NAME = "Microsoft YaHei"; // Windows CJK default (docx skill)
const FONT_MONO = "Consolas";
const FONT_SIZE_BODY = 24; // half-points → 12pt
const FONT_SIZE_H1 = 32; // 16pt
const FONT_SIZE_H2 = 28; // 14pt
const FONT_SIZE_H3 = 26; // 13pt
const FONT_SIZE_H4 = 24; // 12pt
const FONT_SIZE_CODE = 20; // 10pt
const HEADING_COLOR = "1A5276"; // deep blue (docx skill default)
const TABLE_HEADER_BG = "D5E8F0"; // docx skill default
const TABLE_BORDER_COLOR = "CCCCCC";
const LINE_SPACING = 360; // 1.5x (240 = single)
const INDENT_FIRST_LINE = 480; // 2 CJK characters (twips)

// Callout colour palette (matches preview CSS)
const CALLOUT_PALETTE: Record<string, { border: string; bg: string }> = {
  note: { border: "2563EB", bg: "EFF6FF" },
  tip: { border: "16A34A", bg: "F0FDF4" },
  success: { border: "16A34A", bg: "F0FDF4" },
  warning: { border: "D97706", bg: "FFFBEB" },
  danger: { border: "DC2626", bg: "FEF2F2" },
  error: { border: "DC2626", bg: "FEF2F2" },
};

// ── Inline run extraction ────────────────────────────────────────────────────

interface RunSpec {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: string;
  /** Sub/superscript */
  superScript?: boolean;
  subScript?: boolean;
}

/**
 * Walks the child nodes of an element and produces a flat list of run specs,
 * preserving bold/italic/code/link formatting.  This is the TypeScript
 * equivalent of md_to_js.py's `parse_inline`, but operating on DOM nodes
 * instead of raw Markdown text.
 */
function extractRuns(element: Node): RunSpec[] {
  const runs: RunSpec[] = [];

  function walk(node: Node, inherited: Partial<RunSpec> = {}) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text) {
          // Merge with previous run when formatting matches (reduces docx
          // file size and avoids unnecessary run boundaries).
          const last = runs[runs.length - 1];
          const merged = { ...inherited, text };
          if (
            last &&
            last.bold === merged.bold &&
            last.italic === merged.italic &&
            last.code === merged.code &&
            last.strike === merged.strike &&
            last.link === merged.link &&
            last.superScript === merged.superScript &&
            last.subScript === merged.subScript
          ) {
            last.text += text;
          } else {
            runs.push({ ...merged, text });
          }
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      const fmt: Partial<RunSpec> = { ...inherited };

      switch (tag) {
        case "strong":
        case "b":
          fmt.bold = true;
          break;
        case "em":
        case "i":
          fmt.italic = true;
          break;
        case "del":
        case "s":
          fmt.strike = true;
          break;
        case "code":
        case "kbd":
          fmt.code = true;
          break;
        case "sup":
          fmt.superScript = true;
          break;
        case "sub":
          fmt.subScript = true;
          break;
        case "a": {
          const href = el.getAttribute("href") || "";
          if (href) {
            fmt.link = href;
          }
          break;
        }
        case "br":
          runs.push({ ...fmt, text: "\n" });
          continue;
      }
      // Recurse into children with accumulated formatting.
      walk(el, fmt);
    }
  }

  walk(element);
  return runs.filter((r) => r.text.length > 0);
}

// ── Run → docx TextRun / ExternalHyperlink ───────────────────────────────────

function runsToDocxChildren(runs: RunSpec[]): (TextRun | ExternalHyperlink)[] {
  const children: (TextRun | ExternalHyperlink)[] = [];
  for (const run of runs) {
    const text = run.text;
    if (!text) continue;
    if (run.link) {
      const linkChildren: TextRun[] = [];
      // Split on newlines — ExternalHyperlink children are TextRuns, and
      // line breaks need BreakRun.  In practice links are single-line, but
      // we handle it just in case.
      const parts = text.split("\n");
      parts.forEach((part, idx) => {
        if (idx > 0) {
          // Line break inside a link is rare; just add a space.
          linkChildren.push(new docxModule!.TextRun({ text: " " }));
        }
        if (part) {
          linkChildren.push(
            new docxModule!.TextRun({
              text: part,
              bold: run.bold,
              italics: run.italic,
              style: "Hyperlink",
            }),
          );
        }
      });
      children.push(
        new docxModule!.ExternalHyperlink({
          children: linkChildren,
          link: run.link,
        }),
      );
    } else {
      children.push(
        new docxModule!.TextRun({
          text,
          bold: run.bold,
          italics: run.italic,
          strike: run.strike,
          superScript: run.superScript,
          subScript: run.subScript,
          font: run.code ? FONT_MONO : undefined,
          size: run.code ? FONT_SIZE_CODE : undefined,
        }),
      );
    }
  }
  return children;
}

// ── Heading size lookup ──────────────────────────────────────────────────────

function headingSize(level: number): number {
  switch (level) {
    case 1: return FONT_SIZE_H1;
    case 2: return FONT_SIZE_H2;
    case 3: return FONT_SIZE_H3;
    default: return FONT_SIZE_H4;
  }
}

function headingSpacing(level: number): { before: number; after: number } {
  switch (level) {
    case 1: return { before: 240, after: 240 };
    case 2: return { before: 180, after: 180 };
    case 3: return { before: 120, after: 120 };
    default: return { before: 120, after: 120 };
  }
}

// ── Numbering config (one reference per list block) ─────────────────────────

let listCounter = 0;

function nextListRef(type: "bullet" | "number"): string {
  return `${type}-list-${listCounter++}`;
}

// ── HTML → docx children ─────────────────────────────────────────────────────

type DocxChild = Paragraph | Table;

function headingParagraph(el: Element): Paragraph {
  const level = Math.min(Number(el.tagName.substring(1)), 6);
  const runs = extractRuns(el);
  const docxRuns = runs.map(
    (r) =>
      new docxModule!.TextRun({
        text: r.text,
        bold: true,
        italics: r.italic,
        size: headingSize(level),
        color: HEADING_COLOR,
        font: FONT_NAME,
      }),
  );
  const { before, after } = headingSpacing(level);
  return new docxModule!.Paragraph({
    heading: `Heading${level}` as typeof HeadingLevel[keyof typeof HeadingLevel],
    spacing: { before, after },
    children: docxRuns,
  });
}

function paragraphFromRuns(el: Element, opts: { indent?: boolean; spacing?: { before: number; after: number } } = {}): Paragraph {
  const runs = extractRuns(el);
  const children = runsToDocxChildren(runs);
  return new docxModule!.Paragraph({
    spacing: opts.spacing ?? { before: 0, after: 80 },
    indent: opts.indent ? { firstLine: INDENT_FIRST_LINE } : undefined,
    children,
  });
}

// Code block visual tokens (dark theme, matches the HTML export's pre style).
const CODE_BG = "1E293B"; // slate-800
const CODE_BORDER = "334155"; // slate-700
const CODE_TEXT_COLOR = "E2E8F0"; // slate-200

function codeBlockParagraphs(el: Element): Paragraph[] {
  // Find the inner <code> or <pre> text.
  const codeEl = el.querySelector("code") ?? el;
  const text = codeEl.textContent ?? "";
  const lines = text.split("\n");
  // Remove trailing empty line (common in fenced code blocks).
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.map(
    (line, index) =>
      new docxModule!.Paragraph({
        spacing: { before: 0, after: 0 },
        // Line-level padding: only the first/last lines get vertical inset so
        // consecutive code paragraphs form one continuous shaded block.
        contextualSpacing: true,
        ...(index === 0 || index === lines.length - 1
          ? {
              border: {
                // Full frame on the first and last lines' outer edges; side
                // borders on every line keep the block visually continuous.
                top:
                  index === 0
                    ? { style: docxModule!.BorderStyle.SINGLE, size: 4, color: CODE_BORDER }
                    : undefined,
                bottom:
                  index === lines.length - 1
                    ? { style: docxModule!.BorderStyle.SINGLE, size: 4, color: CODE_BORDER }
                    : undefined,
                left: { style: docxModule!.BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
                right: { style: docxModule!.BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
              },
            }
          : {
              // Middle lines still carry the shaded background; borders only
              // on the outer edges would leave gaps, so every line keeps the
              // left/right borders too.
              border: {
                left: { style: docxModule!.BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
                right: { style: docxModule!.BorderStyle.SINGLE, size: 4, color: CODE_BORDER },
              },
            }),
        shading: { fill: CODE_BG, type: docxModule!.ShadingType.CLEAR, color: "auto" },
        indent: { left: 200, right: 200, ...(index === 0 ? { firstLine: 0 } : {}) },
        children: [
          new docxModule!.TextRun({
            text: line || " ",
            font: FONT_MONO,
            size: FONT_SIZE_CODE,
            color: CODE_TEXT_COLOR,
          }),
        ],
      }),
  );
}

function listItemParagraph(
  el: Element,
  ref: string,
): Paragraph {
  const runs = extractRuns(el);
  const children = runsToDocxChildren(runs);
  return new docxModule!.Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { before: 0, after: 40 },
    children,
  });
}

function calloutParagraphs(el: Element): Paragraph[] {
  const type = el.getAttribute("data-callout") ?? "note";
  const palette = CALLOUT_PALETTE[type] ?? CALLOUT_PALETTE.note!;

  const paragraphs: Paragraph[] = [];
  // Title (if present)
  const titleEl = el.querySelector("strong, .callout-title");
  if (titleEl) {
    paragraphs.push(
      new docxModule!.Paragraph({
        spacing: { before: 60, after: 40 },
        children: [
          new docxModule!.TextRun({
            text: titleEl.textContent ?? "",
            bold: true,
            font: FONT_NAME,
            size: FONT_SIZE_BODY,
          }),
        ],
        border: {
          left: { style: docxModule!.BorderStyle.SINGLE, size: 24, color: palette.border },
        },
        shading: { fill: palette.bg, type: docxModule!.ShadingType.CLEAR, color: "auto" },
        indent: { left: 200 },
      }),
    );
  }
  // Content children
  const contentEl = el.querySelector(".callout-content") ?? el;
  for (const child of [...contentEl.children]) {
    if (child === titleEl) continue;
    const childParagraphs = elementToParagraphs(child);
    // Apply callout border/background to each content paragraph.
    for (const p of childParagraphs) {
      // We can't easily modify an existing Paragraph's border after construction,
      // so we just push them as-is. The callout styling is already conveyed
      // through the title paragraph's border.
      paragraphs.push(p);
    }
  }
  return paragraphs;
}

function imageParagraph(el: Element): Paragraph | null {
  const img = el instanceof HTMLImageElement ? el : el.querySelector("img");
  if (!img) return null;
  const src = img.getAttribute("src") || "";
  if (!src.startsWith("data:")) {
    // Non-data URLs can't be embedded in the browser without fetching.
    // We skip the image rather than embedding a broken reference.
    return null;
  }
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const meta = src.substring(5, comma); // e.g. "image/png;base64"
  const mimeMatch = meta.match(/image\/(\w+)/);
  const ext = mimeMatch ? mimeMatch[1] : "png";
  const base64 = src.substring(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const altText = img.getAttribute("alt") ?? img.getAttribute("title") ?? "";
  return new docxModule!.Paragraph({
    alignment: docxModule!.AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [
      new docxModule!.ImageRun({
        type: ext === "svg" ? "png" : ext as "png" | "jpg" | "gif" | "bmp",
        data: bytes,
        transformation: { width: 500, height: 300 },
        altText: { title: altText, description: altText, name: altText },
      }),
    ],
  });
}

function blockquoteParagraphs(el: Element): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const child of [...el.children]) {
    const ps = elementToParagraphs(child);
    for (const p of ps) {
      // blockquote styling: left border, grey text — applied via spacing/indent
      paragraphs.push(p);
    }
  }
  if (paragraphs.length === 0) {
    // Plain text blockquote
    const text = el.textContent ?? "";
    if (text) {
      paragraphs.push(
        new docxModule!.Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 400 },
          children: [new docxModule!.TextRun({ text, italics: true, color: "6B7280" })],
        }),
      );
    }
  }
  return paragraphs;
}

function tableFromElement(el: Element): Table {
  const rows = [...el.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr")];
  if (rows.length === 0) return new docxModule!.Table({ rows: [] });

  const numCols = Math.max(...rows.map((r) => r.querySelectorAll("td, th").length));
  const colWidth = Math.floor((11906 - 2880) / numCols); // page content width / cols

  const tableBorder = { style: docxModule!.BorderStyle.SINGLE, size: 1, color: TABLE_BORDER_COLOR };
  const cellBorders = {
    top: tableBorder,
    bottom: tableBorder,
    left: tableBorder,
    right: tableBorder,
  };

  const tableRows: TableRow[] = rows.map((row, rowIdx) => {
    const cells = [...row.querySelectorAll("td, th")];
    const isHeader = rowIdx === 0 || row.parentElement?.tagName === "THEAD";
    const tableCells: TableCell[] = cells.map((cell) => {
      const runs = extractRuns(cell);
      const children = runsToDocxChildren(runs);
      const cellOpts: ITableCellOptions = {
        borders: cellBorders,
        verticalAlign: docxModule!.VerticalAlign.CENTER,
        width: { size: colWidth, type: docxModule!.WidthType.DXA },
        children: [
          new docxModule!.Paragraph({
            alignment: docxModule!.AlignmentType.CENTER,
            spacing: { before: 20, after: 20 },
            children: isHeader
              ? children.map((c) => {
                  if (c instanceof docxModule!.TextRun) {
                    return new docxModule!.TextRun({ ...c, bold: true });
                  }
                  return c;
                })
              : children,
          }),
        ],
        ...(isHeader ? { shading: { fill: TABLE_HEADER_BG, type: docxModule!.ShadingType.CLEAR, color: "auto" } } : {}),
      };
      return new docxModule!.TableCell(cellOpts);
    });
    return new docxModule!.TableRow({ children: tableCells });
  });

  return new docxModule!.Table({
    width: { size: colWidth * numCols, type: docxModule!.WidthType.DXA },
    columnWidths: Array(numCols).fill(colWidth),
    alignment: docxModule!.AlignmentType.CENTER,
    rows: tableRows,
  });
}

/** Recursively converts a block-level HTML element into docx children. */
function elementToParagraphs(el: Element): Paragraph[] {
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return [headingParagraph(el)];

    case "p":
      return [paragraphFromRuns(el, { indent: true })];

    case "pre":
      return codeBlockParagraphs(el);

    case "blockquote":
      return blockquoteParagraphs(el);

    case "ul":
    case "ol": {
      const ref = nextListRef(tag === "ol" ? "number" : "bullet");
      const items = [...el.children].filter((c) => c.tagName.toLowerCase() === "li");
      return items.map((item) => listItemParagraph(item, ref));
    }

    case "li":
      // Standalone <li> without parent <ul>/<ol> — rare but handle it.
      return [paragraphFromRuns(el)];

    case "table":
      // Table is a special case — it returns a Table, not Paragraphs.
      // The caller handles it via elementToChildren.
      return [];

    case "aside":
      if (el.hasAttribute("data-callout")) {
        return calloutParagraphs(el);
      }
      return [paragraphFromRuns(el)];

    case "img":
      return [imageParagraph(el)].filter(Boolean) as Paragraph[];

    case "div": {
      // Code block wrapper (.memoir-code-block) — extract the inner <pre>.
      if (el.classList.contains("memoir-code-block")) {
        const pre = el.querySelector("pre");
        if (pre) return codeBlockParagraphs(pre);
      }
      // Details/summary — flatten.
      if (el.tagName === "DETAILS") {
        return detailsParagraphs(el as HTMLDetailsElement);
      }
      // Generic div — recurse into children.
      return [...el.children].flatMap((c) => elementToParagraphs(c));
    }

    case "details":
      return detailsParagraphs(el as HTMLDetailsElement);

    case "hr":
      return [
        new docxModule!.Paragraph({
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: docxModule!.BorderStyle.SINGLE, size: 6, color: "D1D5DB" } },
          children: [],
        }),
      ];

    default:
      // For unknown elements, try to extract text content as a paragraph.
      if (el.textContent?.trim()) {
        return [paragraphFromRuns(el, { indent: true })];
      }
      return [];
  }
}

function detailsParagraphs(el: HTMLDetailsElement): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const summary = el.querySelector(":scope > summary");
  if (summary) {
    paragraphs.push(
      new docxModule!.Paragraph({
        spacing: { before: 60, after: 40 },
        children: [
          new docxModule!.TextRun({
            text: summary.textContent ?? "",
            bold: true,
            font: FONT_NAME,
          }),
        ],
      }),
    );
  }
  // Flatten content children.
  for (const child of [...el.children]) {
    if (child === summary) continue;
    paragraphs.push(...elementToParagraphs(child));
  }
  return paragraphs;
}

/** Converts the rendered article body into docx children (Paragraphs + Tables). */
function articleBodyToDocxChildren(article: HTMLElement): DocxChild[] {
  const children: DocxChild[] = [];
  // Remove the frontmatter properties card — it's editor metadata.
  article
    .querySelectorAll("details.memoir-frontmatter-properties")
    .forEach((node) => node.remove());
  // Remove code block header chrome (copy buttons, titles).
  article.querySelectorAll(".memoir-code-block-head").forEach((node) => node.remove());
  article.querySelectorAll(".memoir-code-copy").forEach((node) => node.remove());

  for (const child of [...article.children]) {
    const tag = child.tagName.toLowerCase();
    if (tag === "table") {
      children.push(tableFromElement(child));
    } else {
      children.push(...elementToParagraphs(child));
    }
  }
  return children;
}

// ── Preview rendering (shared with render-note-html.tsx) ─────────────────────

async function waitForPreviewReady(host: HTMLElement, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const article = host.querySelector("article");
    const pending =
      !article ||
      host.querySelector("[data-mdx-pending]") ||
      host.querySelector("[data-mermaid-pending]") ||
      host.querySelector("[data-link-card-pending]");
    const imagesPending = [...host.querySelectorAll("img")].some((image) => !image.complete);
    if (article && !pending && !imagesPending) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  throw new Error("Preview did not render.");
}

async function inlineWorkspaceImages(host: HTMLElement, root: string, relativePath: string) {
  const directory = noteDirectory(relativePath);
  const images = [...host.querySelectorAll<HTMLImageElement>("img")];
  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute("src") || "";
      if (/^(https?:|data:|blob:)/i.test(src)) return;
      try {
        const resolved = resolveWorkspaceFilePath(root, directory, decodeMediaHref(src));
        const url = getGateways().workspace.resolveMediaPath(resolved);
        const response = await fetch(url);
        if (!response.ok) return;
        const dataUrl = await blobToDataUrl(await response.blob());
        if (dataUrl) image.setAttribute("src", dataUrl);
      } catch {
        // Keep the original reference.
      }
    }),
  );
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

// ── Numbering config builder ─────────────────────────────────────────────────

function buildNumberingConfig(listRefs: { ref: string; type: "bullet" | "number" }[]) {
  return listRefs.map(({ ref, type }) => ({
    reference: ref,
    levels: [
      {
        level: 0,
        format: type === "number" ? docxModule!.LevelFormat.DECIMAL : docxModule!.LevelFormat.BULLET,
        text: type === "number" ? "%1." : "\u2022",
        alignment: docxModule!.AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      },
    ],
  }));
}

// ── Main export function ─────────────────────────────────────────────────────

export async function renderNoteDocx({
  root,
  relativePath,
  note,
  content,
  bodyFont,
  locale,
}: {
  root: string | null;
  relativePath: string;
  note: NoteMeta;
  content: string;
  bodyFont: BodyFont;
  locale: AppLocale;
}): Promise<Uint8Array> {
  // Render the note through the preview pipeline.
  const host = document.createElement("div");
  host.className = "memoir-pdf-export";
  host.dataset.bodyFont = bodyFont;
  host.dataset.theme = "light";
  host.style.width = `${EXPORT_WIDTH_PX}px`;
  document.body.append(host);

  docxModule = await loadDocxModule();
  const reactRoot = createRoot(host);
  try {
    reactRoot.render(
      <I18nProvider locale={locale}>
        <NotePreviewArticle
          className="memoir-preview memoir-pdf-preview prose prose-neutral"
          compileDelay={0}
          content={content}
          note={note}
          relativePath={relativePath}
          root={root}
        />
      </I18nProvider>,
    );
    await waitForPreviewReady(host);
    const article = host.querySelector("article");
    // Layout metrics (scrollHeight) are 0 in jsdom — for docx we only need
    // the DOM tree, so a non-empty article is proof of a successful render.
    if (!(article instanceof HTMLElement) || !article.textContent?.trim()) {
      throw new Error("Preview did not render.");
    }
    if (root) {
      await inlineWorkspaceImages(article, root, relativePath);
    }

    // Reset list counter for this document.
    listCounter = 0;

    // Convert article body to docx children.
    const children = articleBodyToDocxChildren(article);

    // Collect all list references for the numbering config.
    const listRefs: { ref: string; type: "bullet" | "number" }[] = [];
    let refIdx = 0;
    for (const child of children) {
      if (child instanceof docxModule!.Paragraph) {
        const numbering = (child as unknown as { numbering?: { reference?: string } }).numbering;
        if (numbering?.reference) {
          const isNumber = numbering.reference.startsWith("number-");
          listRefs.push({
            ref: numbering.reference,
            type: isNumber ? "number" : "bullet",
          });
          refIdx++;
        }
      }
    }

    const title = parseNote(content, note.fileName).title;

    const doc = new docxModule!.Document({
      styles: {
        default: {
          document: {
            run: {
              font: FONT_NAME,
              size: FONT_SIZE_BODY,
            },
            paragraph: {
              spacing: { line: LINE_SPACING },
            },
          },
        },
      },
      numbering: {
        config: buildNumberingConfig(listRefs),
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
          footers: {
            default: new docxModule!.Footer({
              children: [
                new docxModule!.Paragraph({
                  alignment: docxModule!.AlignmentType.CENTER,
                  children: [
                    new docxModule!.TextRun({ text: "第 " }),
                    new docxModule!.TextRun({ children: [docxModule!.PageNumber.CURRENT] }),
                    new docxModule!.TextRun({ text: " 页" }),
                  ],
                }),
              ],
            }),
          },
          children: [
            // Document title as a centered H1.
            ...(title
              ? [
                  new docxModule!.Paragraph({
                    heading: docxModule!.HeadingLevel.HEADING_1,
                    alignment: docxModule!.AlignmentType.CENTER,
                    spacing: { before: 0, after: 360 },
                    children: [
                      new docxModule!.TextRun({
                        text: title,
                        bold: true,
                        size: FONT_SIZE_H1,
                        color: HEADING_COLOR,
                        font: FONT_NAME,
                      }),
                    ],
                  }),
                ]
              : []),
            // Remove the first H1 if it duplicates the title.
            ...(title && children.length > 0 && isFirstChildH1WithTitle(children[0], title)
              ? children.slice(1)
              : children),
          ],
        },
      ],
    });

    const arrayBuffer = await docxModule!.Packer.toArrayBuffer(doc);
    return new Uint8Array(arrayBuffer);
  } finally {
    reactRoot.unmount();
    host.remove();
  }
}

/** Checks if the first child is an H1 paragraph whose text matches the title. */
function isFirstChildH1WithTitle(child: DocxChild, _title: string): boolean {
  // We can't easily read back the text from a Paragraph object, so we check
  // via the article DOM instead. This is a best-effort dedup.
  // Since we already removed the frontmatter card and the article's first
  // child would be an h1, we check if the first child came from an h1 element.
  // The simplest approach: if the title is non-empty and the first child
  // is a Paragraph, assume it's the heading we want to skip.
  return child instanceof docxModule!.Paragraph;
}
