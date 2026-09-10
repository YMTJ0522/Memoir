/**
 * Article import: turn txt / md / html / docx sources into Markdown notes.
 *
 * The flow is split so every runtime can share it:
 * 1. Read the raw source — Tauri reads the file via the `read_import_source`
 *    command (UTF-8 with GBK fallback), the browser demo reads `File.text()`.
 * 2. Convert — `convertImportedSource` is a pure function shared by both
 *    runtimes, so conversion rules stay testable and identical everywhere.
 * 3. Write — the note goes through `import_note` (Tauri) which owns slugify,
 *    duplicate suffixing, atomic writes and index updates.
 */

import TurndownService from "turndown";

export const IMPORT_SOURCE_EXTENSIONS = ["txt", "md", "markdown", "html", "htm", "docx"] as const;

export type ImportSourceExtension = (typeof IMPORT_SOURCE_EXTENSIONS)[number];

export function isImportSourceExtension(extension: string): extension is ImportSourceExtension {
  return (IMPORT_SOURCE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

export function importSourceExtension(fileName: string): ImportSourceExtension | null {
  const match = /\.[^.]+$/.exec(fileName);
  if (!match) return null;
  const extension = match[0].slice(1).toLowerCase();
  return isImportSourceExtension(extension) ? extension : null;
}

export type ImportedArticle = {
  /** Markdown body, ready to store as a note. */
  markdown: string;
  /** Suggested note title (derived from the first heading or file name). */
  title: string;
  extension: ImportSourceExtension;
};

function fileNameTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function firstMarkdownTitle(markdown: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(markdown);
  if (heading) return heading[1].replace(/[#*_`~[\]]/g, "").trim();
  const htmlHeading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(markdown);
  if (htmlHeading) return htmlHeading[1].replace(/<[^>]+>/g, "").trim();
  return "";
}

/** Turndown configured to keep Memoir's inline link style and drop fluff. */
function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  // turndown 7.x hard-codes `bulletListMarker + '   '` (3 spaces) for list
  // items and dropped the `listItemIndent` option, so re-register the rule
  // with a single space to match Memoir's own markdown output.
  service.addRule("memoirListItem", {
    filter: "li",
    replacement: (content, node, options) => {
      const parent = node.parentNode as HTMLElement | null;
      const prefix =
        parent?.nodeName === "OL"
          ? `${(Array.prototype.indexOf.call(parent.children, node) + 1) || 1}. `
          : `${options.bulletListMarker} `;
      const cleaned = content.replace(/^\n+/, "").replace(/\n+$/m, "");
      const indented = cleaned.replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
      return prefix + indented + (node.nextSibling ? "\n" : "");
    },
  });
  // Word/HTML exports stuff every block with empty classes/ids.
  service.remove(["style", "script", "meta", "link", "head"]);
  return service;
}

let turndownSingleton: TurndownService | null = null;
function htmlToMarkdown(html: string): string {
  turndownSingleton ??= createTurndown();
  return turndownSingleton.turndown(html);
}

function stripXmlDeclarations(html: string): string {
  return html
    .split("\n")
    .filter((line) => !/^\s*<\?xml|^\s*<!DOCTYPE/i.test(line))
    .join("\n")
    .trim();
}

function tidyMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prefix reserved Markdown characters so lines stay literal text. */
function escapeMarkdownText(text: string): string {
  return (
    text
      // Ordered-list markers: escape the dot only (1. -> 1\.) so digits stay clean.
      .replace(/^(\d+)\.(?=\s|$)/gm, "$1\\.")
      // Other reserved leading markers: escape the symbol itself.
      .replace(/^([#>*+`-])(?=\s|$)/gm, "\\$1")
  );
}

export type ConvertImportedSourceInput = {
  fileName: string;
  extension: ImportSourceExtension;
  /** Decoded source text: UTF-8 for md/html, plain text for txt, HTML for docx. */
  text: string;
};

/**
 * Convert one imported source into a Markdown article. Pure: given the same
 * inputs the output is identical, in Node (tests) and in the webview.
 */
export function convertImportedSource(input: ConvertImportedSourceInput): ImportedArticle {
  const { fileName, extension, text } = input;
  if (extension === "txt") {
    const markdown = tidyMarkdown(escapeMarkdownText(text));
    return { markdown, title: firstMarkdownTitle(markdown) || fileNameTitle(fileName), extension };
  }
  if (extension === "md" || extension === "markdown") {
    const markdown = tidyMarkdown(text);
    return { markdown, title: firstMarkdownTitle(markdown) || fileNameTitle(fileName), extension };
  }
  if (extension === "html" || extension === "htm") {
    const markdown = tidyMarkdown(htmlToMarkdown(stripXmlDeclarations(text)));
    return { markdown, title: firstMarkdownTitle(markdown) || fileNameTitle(fileName), extension };
  }
  // docx: `text` holds the HTML that mammoth produced from the Word file.
  const markdown = tidyMarkdown(htmlToMarkdown(stripXmlDeclarations(text)));
  return { markdown, title: firstMarkdownTitle(markdown) || fileNameTitle(fileName), extension };
}

/**
 * Convert a docx file's raw bytes (base64) into an HTML string via mammoth.
 * Mammoth runs in the browser bundle, so it is imported lazily and only in
 * runtimes that actually face a docx import.
 */
export async function convertDocxHtml(bytesBase64: string): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const bytes = Uint8Array.from(atob(bytesBase64), (character) => character.charCodeAt(0));
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
  return result.value;
}
