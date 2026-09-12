/**
 * Mind-map specific Markdown helpers.
 *
 * The mind map is built from the *heading outline* of the current note. We
 * extract heading lines (with their original line indexes) straight from the
 * raw note content, so edits can be written back to the exact heading lines.
 */

export type MindHeading = {
  /** 1-based heading level (number of `#`). */
  depth: number;
  /** Cleaned heading text. */
  text: string;
  /** 0-based line index in the raw Markdown content. */
  line: number;
};

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Unescape common Markdown punctuation backslash escapes (`\.`, `\(`, `\[`,
 * `\*`, `\_`, `\-`, …) so headings that were written escaped (e.g. a literal
 * `7\.5` produced by an LLM) display cleanly in the mind map instead of
 * showing the raw backslash. Only affects the display text; the original line
 * is untouched, so editing still rewrites the exact heading line.
 */
function unescapeHeadingText(text: string): string {
  return text.replace(/\\([\\`*_[\]()#+\-.!>])/g, "$1");
}

/**
 * Extract heading lines from raw Markdown, skipping fenced code blocks and
 * empty/cleanup of inline markers. Mirrors `extractHeadings` but keeps the
 * original line number of each heading.
 */
export function extractMindHeadings(content: string): MindHeading[] {
  const headings: MindHeading[] = [];
  let inFence = false;

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = HEADING_RE.exec(line);
    if (!match) continue;
    const text = unescapeHeadingText(match[2].replace(/[#`*_~]/g, "")).trim();
    if (!text) continue;
    headings.push({ depth: match[1].length, text, line: index });
  }

  return headings;
}

/** Build the markdown that only contains headings (one heading per line). */
export function headingsToMarkdown(headings: MindHeading[]): string {
  return headings.map((heading) => `${"#".repeat(heading.depth)} ${heading.text}`).join("\n");
}

export type HeadingEditCommand =
  | { kind: "rename"; line: number; text: string }
  | { kind: "indent"; line: number }
  | { kind: "outdent"; line: number }
  | { kind: "delete"; line: number }
  | { kind: "insert"; line: number; text: string; level: number };

function splitLines(content: string): string[] {
  return content.split("\n");
}

function joinWithTrailingNewline(lines: string[], original: string): string {
  const joined = lines.join("\n");
  return original.endsWith("\n") && !joined.endsWith("\n") ? `${joined}\n` : joined;
}

function clampLine(lines: string[], line: number): number {
  return Math.max(0, Math.min(line, lines.length - 1));
}

/**
 * Apply a heading edit to raw Markdown content and return the new content.
 * Line indexes refer to the original content; edits are line-based so body
 * text and frontmatter are never touched.
 */
export function applyHeadingEdit(content: string, command: HeadingEditCommand): string {
  const lines = splitLines(content);
  const at = clampLine(lines, command.line);

  switch (command.kind) {
    case "rename": {
      const match = HEADING_RE.exec(lines[at]);
      if (!match) return content;
      const text = command.text.trim().replace(/[#`*_~]/g, "");
      if (!text) return content;
      lines[at] = `${"#".repeat(match[1].length)} ${text}`;
      return joinWithTrailingNewline(lines, content);
    }
    case "indent": {
      const match = HEADING_RE.exec(lines[at]);
      if (!match) return content;
      if (match[1].length >= 6) return content;
      lines[at] = `#${lines[at]}`;
      return joinWithTrailingNewline(lines, content);
    }
    case "outdent": {
      const match = HEADING_RE.exec(lines[at]);
      if (!match) return content;
      if (match[1].length <= 1) return content;
      lines[at] = lines[at].slice(1);
      return joinWithTrailingNewline(lines, content);
    }
    case "delete": {
      lines.splice(at, 1);
      return joinWithTrailingNewline(lines, content);
    }
    case "insert": {
      const level = Math.max(1, Math.min(6, command.level));
      const text = command.text.trim().replace(/[#`*_~]/g, "");
      if (!text) return content;
      lines.splice(at + 1, 0, `${"#".repeat(level)} ${text}`);
      return joinWithTrailingNewline(lines, content);
    }
    default:
      return content;
  }
}