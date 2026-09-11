/**
 * Flowchart view helpers.
 *
 * The flowchart view renders ```mermaid fenced code blocks from the current
 * note. We extract them straight from the raw Markdown (with their block
 * indexes) so the view can list several diagrams and re-render as the note
 * is being edited.
 */

export type MermaidBlock = {
  /** 0-based index of the block within the note (order of appearance). */
  index: number;
  /** The mermaid source inside the fence (trimmed, no fence lines). */
  code: string;
  /** Optional fence info string, e.g. `mermaid` plus optional modifiers. */
  info: string;
};

// NOTE: use [ \t] instead of \s and no `$` anchor — `.` and `\s` would
// also eat the `\r` of CRLF files and `(.*)$` cannot match a trailing `\r`,
// which broke fence detection on Windows line endings.
const FENCE_RE = /^[ \t]*(```|~~~)[ \t]*([\w-]*)/;

/**
 * Extract ```mermaid fenced code blocks from raw Markdown.
 *
 * Fence toggling logic mirrors `extractMindHeadings`: any ``` or ~~~ line
 * toggles the fence state so headings inside ordinary code blocks are
 * skipped; only fences whose info string is `mermaid` are collected.
 */
export function extractMermaidBlocks(content: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  const lines = content.split("\n");
  let inFence = false;
  let fenceMarker = "";
  let current: { info: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (!inFence) {
      const match = FENCE_RE.exec(line);
      if (!match) continue;
      inFence = true;
      fenceMarker = match[1];
      current = { info: (match[2] || "").toLowerCase(), lines: [] };
      continue;
    }
    // Closing fence: same marker type (``` or ~~~), nothing but whitespace.
    if (line.trim().startsWith(fenceMarker) && line.trim() === fenceMarker) {
      if (current && current.info === "mermaid") {
        const code = current.lines.join("\n").trim();
        if (code) {
          blocks.push({ index: blocks.length, code, info: current.info });
        }
      }
      inFence = false;
      current = null;
      continue;
    }
    current?.lines.push(line);
  }

  return blocks;
}

// Diagram openers recognized by mermaid 11. `[
// 	]*`-separated direction tokens like `TD` / `LR` are stripped too.
const OPENER_RE =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|sankey|xychart|block-beta|architecture-beta|packet|kanban|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)[\w-]*[ \t]*(?:[A-Za-z]{1,2}[ \t]*)?/i;

/** Build a short label for a diagram from its first meaningful line. */
export function mermaidBlockLabel(block: MermaidBlock): string {
  let firstLine = "";
  for (const raw of block.code.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (!firstLine) firstLine = line;
    const stripped = line.replace(OPENER_RE, "");
    // A line that is nothing but the diagram opener (`flowchart TD`,
    // `sequenceDiagram`, …) carries no subject — skip it and label from
    // the first actual content line instead.
    if (!stripped) continue;
    return stripped.replace(/\s+/g, " ").slice(0, 42);
  }
  // Every line was an opener (e.g. a bare `pie` diagram): fall back to it.
  return firstLine.replace(/\s+/g, " ").slice(0, 42);
}
