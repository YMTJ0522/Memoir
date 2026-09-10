/**
 * Transform half of the container pipeline for the markdown preview:
 * Obsidian-style callouts on blockquotes (`> [!note] 标题`), directive-syntax
 * containers (`:::details{title="..."}` via remark-directive) and the
 * space-syntax containers written by the toolbar (`::: details 标题` /
 * `:::: tabs` + `::: tab-item 标签`), which micromark cannot parse as
 * directives. Pair with the `remarkDirective` parser plugin; see
 * NotePreviewArticle for the actual plugin ordering.
 */

import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

type MdastPoint = { line?: number; column?: number; offset?: number };

type MdastNode = {
  type: string;
  name?: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  attributes?: Record<string, unknown>;
  position?: { start?: MdastPoint; end?: MdastPoint };
};

const CALLOUT_TYPES = new Set(["note", "tip", "warning", "danger", "info", "success", "question", "quote", "bug"]);
const CALLOUT_ALIASES: Record<string, string> = {
  abstract: "note",
  summary: "note",
  tldr: "note",
  hint: "tip",
  important: "tip",
  check: "success",
  done: "success",
  caution: "warning",
  attention: "warning",
  error: "danger",
  failure: "danger",
  fail: "danger",
  example: "info",
  cite: "quote",
};
const DEFAULT_CALLOUT_TITLE: Record<string, string> = {
  note: "NOTE",
  tip: "TIP",
  warning: "WARNING",
  danger: "DANGER",
  info: "INFO",
  success: "SUCCESS",
  question: "QUESTION",
  quote: "QUOTE",
  bug: "BUG",
};
const DEFAULT_DETAILS_SUMMARY = "详情";
const FALLBACK_TAB_LABEL = "标签";

/** `::: details [标题]` opener line. */
const SPACE_DETAILS_OPEN = /^(:{3,})[ \t]+details\b(?:[ \t]+(.*))?$/;
/** `:::: tabs` opener line. */
const SPACE_TABS_OPEN = /^(:{3,})[ \t]+tabs\b(?:[ \t]+.*)?$/;
/** `::: tab-item 标签` child opener line inside a tabs block. */
const SPACE_TAB_ITEM_OPEN = /^(:{3,})(?:[ \t]+tab-item)(?:[ \t]+(.*?))?[ \t]*$/;
/** `:selected:` option line at the head of a tab-item body. */
const TAB_OPTION = /^:([a-z][a-z0-9_-]*):(?:[ \t]+.*)?$/i;
/** Container closing line: a bare marker run of at least the opener length. */
const CONTAINER_CLOSE = /^(:{3,})[ \t]*$/;
/** Another container opener (nesting depth guard). */
const NESTED_OPEN = /^(:{3,})[ \t]+(?:details|tabs|tab-item)\b/;

function mergeClassName(existing: unknown, ...extras: string[]) {
  let parts: string[] = [];
  if (Array.isArray(existing)) parts = existing.filter((part): part is string => typeof part === "string");
  else if (typeof existing === "string" && existing.trim()) parts = existing.split(/\s+/);
  for (const extra of extras) if (!parts.includes(extra)) parts.push(extra);
  return parts;
}

/** Reads the attributes remark-directive attaches to directive nodes. */
function readDirectiveAttributes(node: MdastNode): Record<string, string> {
  const out: Record<string, string> = {};
  const attributes = node.attributes;
  if (!attributes || typeof attributes !== "object") return out;
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/** `[方括号标题]` → `方括号标题` (unchanged when not bracketed). */
export function stripBracketTitle(value: string): string {
  const trimmed = value.trim();
  return /^\[[\s\S]*\]$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
}

/**
 * Parses an Obsidian callout marker line such as `[!note]+ 标题`.
 * Returns null when the text is not a callout marker.
 */
export function parseCalloutMarker(text: string): { type: string; title: string; fold: string } | null {
  const match = /^\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-])?(?:[ \t]+(.*?))?[ \t]*$/.exec(text.trim());
  if (!match) return null;
  const raw = match[1].toLowerCase();
  const type = CALLOUT_TYPES.has(raw) ? raw : CALLOUT_ALIASES[raw] || "note";
  return {
    type,
    title: (match[3] || "").trim(),
    fold: match[2] || "",
  };
}

/** Directive names are lowercased; titles come from `title` attributes. */
export function parseContainerLabel(value: string | undefined) {
  return { name: (value || "").trim().toLowerCase(), title: "" };
}

function titleNode(value: string, hName: string, className: string): MdastNode {
  return {
    type: "paragraph",
    data: {
      hName,
      hProperties: { className },
    },
    children: [{ type: "text", value }],
  };
}

function startsWithContainerMarker(node: MdastNode): boolean {
  if (node.type !== "paragraph") return false;
  const first = node.children?.[0];
  return Boolean(first && first.type === "text" && (first.value ?? "").startsWith(":::"));
}

function nodeStartLine(node: MdastNode): number {
  return (node.position?.start?.line ?? 0) - 1;
}

/**
 * `> [!note] 标题` callouts: remark merges the whole blockquote into one
 * paragraph whose first text node starts with the marker line. Split the
 * marker off, then rebuild the node as `aside` (or `details` when the
 * `+`/`-` fold marker is present).
 */
function transformCallout(node: MdastNode) {
  const first = node.children?.[0];
  if (first?.type !== "paragraph") return;
  const firstText = first.children?.[0];
  if (!firstText || firstText.type !== "text") return;
  const value = firstText.value || "";
  const newline = value.indexOf("\n");
  const firstLine = newline >= 0 ? value.slice(0, newline) : value;
  const remainder = newline >= 0 ? value.slice(newline + 1) : "";
  const marker = parseCalloutMarker(firstLine);
  if (!marker) return;
  const heading = marker.title || DEFAULT_CALLOUT_TITLE[marker.type] || "NOTE";
  const inlineRest: MdastNode[] = [
    ...(remainder.trim() ? [{ type: "text", value: remainder } as MdastNode] : []),
    ...(first.children?.slice(1) || []),
  ];
  node.data = {
    ...node.data,
    hName: marker.fold ? "details" : "aside",
    hProperties: {
      ...node.data?.hProperties,
      className: mergeClassName(node.data?.hProperties?.className, "memoir-callout"),
      dataCallout: marker.type,
      ...(marker.fold === "+" ? { open: true } : {}),
    },
  };
  node.children = [
    titleNode(heading, marker.fold ? "summary" : "strong", "memoir-callout-title"),
    ...(inlineRest.length ? [{ type: "paragraph", children: inlineRest } as MdastNode] : []),
    ...(node.children || []).slice(1),
  ];
}

function transformContainer(node: MdastNode) {
  const { name } = parseContainerLabel(node.name);
  const title = readDirectiveAttributes(node).title ?? "";
  if (name === "details") {
    node.data = {
      ...node.data,
      hName: "details",
      hProperties: {
        ...node.data?.hProperties,
        className: mergeClassName(node.data?.hProperties?.className, "memoir-details"),
      },
    };
    node.children = [
      titleNode(title || DEFAULT_DETAILS_SUMMARY, "summary", "memoir-details-summary"),
      ...(node.children || []),
    ];
    return;
  }
  if (name === "tabs") {
    const children = node.children || [];
    const tabChildren = children.filter(
      (child) => child.type === "containerDirective" && parseContainerLabel(child.name).name === "tab",
    );
    if (!tabChildren.length) return;
    const wrapped = tabChildren.map((child, tabIndex) => {
      const childTitle = readDirectiveAttributes(child).title || `${FALLBACK_TAB_LABEL} ${tabIndex + 1}`;
      return {
        ...child,
        data: {
          ...child.data,
          hName: "section",
          hProperties: {
            ...child.data?.hProperties,
            className: mergeClassName(child.data?.hProperties?.className, "memoir-tab"),
            dataTabLabel: childTitle,
            dataTabPanel: String(tabIndex),
          },
        },
        children: child.children || [],
      };
    });
    node.data = {
      ...node.data,
      hName: "div",
      hProperties: {
        ...node.data?.hProperties,
        className: mergeClassName(node.data?.hProperties?.className, "memoir-tabs", "memoir-tabs-interactive"),
        dataTabs: "true",
      },
    };
    node.children = wrapped;
  }
}

/* ---------------------------------------------------------------------------
 * Space-syntax containers (`::: details 标题` / `:::: tabs`).
 *
 * micromark cannot parse these as directives (remark-directive only accepts
 * `[label]`/`{attrs}` suffixes), so the toolbar's own syntax must be rebuilt
 * at the mdast level: scan root children for paragraphs starting with `:::`,
 * consume everything up to the matching close line, and re-parse that source
 * slice with a private remark parser (code fences and nested markers tracked
 * by depth). Re-parsing — instead of reusing already-parsed siblings — also
 * covers the "glued" case where micromark folds opener, body and close into
 * one paragraph. Running this plugin *before* remark-wiki-links & co. means
 * re-parsed content still flows through the rest of the inline pipeline.
 * ------------------------------------------------------------------------- */

/**
 * Sync fragment parser for container bodies. A static `import { remark }`
 * of the full preview pipeline would cycle at module init, so the fragment
 * parser is its own minimal processor with the same parser plugins.
 */
let fragmentParser: ReturnType<typeof buildFragmentParser> | null = null;

function buildFragmentParser() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective);
}

/** Character offset at which each line of `lines` starts. */
function buildLineOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

/**
 * Re-parses a source slice and shifts every position back into document
 * coordinates (mdast positions restart at line 1 / offset 0 per fragment).
 * `lineDelta` is the 0-based document line of the slice's first line;
 * `offsetDelta` the character offset of the slice in the document.
 */
function reparseFragment(source: string, lineDelta: number, offsetDelta: number): MdastNode[] {
  if (!source.trim()) return [];
  try {
    fragmentParser = fragmentParser || buildFragmentParser();
    const root = fragmentParser.parse(source) as MdastNode;
    const children = root.children || [];
    for (const child of children) shiftPositions(child, lineDelta, offsetDelta);
    return children;
  } catch {
    return [];
  }
}

function shiftPositions(node: MdastNode, lineDelta: number, offsetDelta: number) {
  const position = node.position;
  if (position) {
    shiftPoint(position.start, lineDelta, offsetDelta);
    shiftPoint(position.end, lineDelta, offsetDelta);
  }
  node.children?.forEach((child) => shiftPositions(child, lineDelta, offsetDelta));
}

function shiftPoint(point: MdastPoint | undefined, lineDelta: number, offsetDelta: number) {
  if (!point) return;
  if (typeof point.line === "number") point.line += lineDelta;
  if (typeof point.offset === "number") point.offset += offsetDelta;
}

/**
 * Finds the line index of the closing marker of a space-syntax container
 * started at `startLine`, honoring code fences and nesting. Returns -1 when
 * unclosed (the block then stays a plain paragraph).
 */
function findSpaceContainerEnd(lines: string[], startLine: number, markerLength: number): number {
  let depth = 1;
  let fence: { char: string; length: number } | null = null;
  for (let line = startLine + 1; line < lines.length; line++) {
    const text = lines[line] ?? "";
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[1] || "";
      if (!fence) fence = { char: marker[0] || "`", length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const nested = NESTED_OPEN.exec(text);
    if (nested && (nested[1] || "").length >= markerLength) depth += 1;
    const close = CONTAINER_CLOSE.exec(text);
    if (close && (close[1] || "").length >= markerLength) {
      depth -= 1;
      if (depth === 0) return line;
    }
  }
  return -1;
}

/** `open` / `+` prefixes mark the details element open. */
function parseSpaceDetails(rawInfo: string): { open: boolean; title: string } {
  const stripped = rawInfo.replace(/^(?:open|\+)[ \t]*/, "");
  return { open: stripped !== rawInfo, title: stripBracketTitle(stripped) };
}

type SpaceTabItem = {
  title: string;
  selected: boolean;
  content: string;
  /** 0-based document line of the first content line (for position fixes). */
  contentStartLine: number;
};

/** Splits a tabs block body into per tab-item source segments. */
function parseSpaceTabs(
  lines: string[],
  start: number,
  end: number,
): SpaceTabItem[] | null {
  const tabs: SpaceTabItem[] = [];
  let line = start;
  while (line < end) {
    const opener = SPACE_TAB_ITEM_OPEN.exec(lines[line] ?? "");
    if (!opener) {
      line += 1;
      continue;
    }
    const markerLength = (opener[1] || "").length;
    let close = -1;
    let depth = 1;
    let fence: { char: string; length: number } | null = null;
    for (let candidate = line + 1; candidate < end; candidate++) {
      const text = lines[candidate] ?? "";
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
      if (fenceMatch) {
        const marker = fenceMatch[1] || "";
        if (!fence) fence = { char: marker[0] || "`", length: marker.length };
        else if (marker[0] === fence.char && marker.length >= fence.length) fence = null;
        continue;
      }
      if (fence) continue;
      const nested = NESTED_OPEN.exec(text);
      if (nested && (nested[1] || "").length >= markerLength) depth += 1;
      const closeMatch = CONTAINER_CLOSE.exec(text);
      if (closeMatch && (closeMatch[1] || "").length >= markerLength) {
        depth -= 1;
        if (depth === 0) {
          close = candidate;
          break;
        }
      }
    }
    if (close < 0) return null;
    let contentStart = line + 1;
    let selected = false;
    while (contentStart < close) {
      const option = TAB_OPTION.exec(lines[contentStart] ?? "");
      if (!option) break;
      if ((option[1] || "").toLowerCase() === "selected") selected = true;
      contentStart += 1;
    }
    if (contentStart < close && !(lines[contentStart] ?? "").trim()) contentStart += 1;
    tabs.push({
      title: stripBracketTitle(opener[2] ?? "") || FALLBACK_TAB_LABEL,
      selected,
      content: lines.slice(contentStart, close).join("\n"),
      contentStartLine: contentStart,
    });
    line = close + 1;
  }
  return tabs;
}

/**
 * Rebuilds space-syntax containers from raw source lines. Runs once over the
 * root children, replacing consumed sibling runs with re-parsed details or
 * tabs subtrees. Sibling consumption is driven by source line numbers.
 */
function transformSpaceContainers(tree: MdastNode, lines: string[]) {
  const children = tree.children ?? [];
  const output: MdastNode[] = [];
  const lineOffsets = buildLineOffsets(lines);
  let index = 0;
  while (index < children.length) {
    const node = children[index];
    if (!node) {
      index += 1;
      continue;
    }
    const startLine = nodeStartLine(node);
    const firstLine = lines[startLine] ?? "";
    const detailsMatch = startsWithContainerMarker(node) ? SPACE_DETAILS_OPEN.exec(firstLine) : null;
    const tabsMatch = !detailsMatch && startsWithContainerMarker(node) ? SPACE_TABS_OPEN.exec(firstLine) : null;
    if (!detailsMatch && !tabsMatch) {
      output.push(node);
      index += 1;
      continue;
    }
    const markerLength = ((detailsMatch ?? tabsMatch)?.[1] || "").length;
    const endLine = findSpaceContainerEnd(lines, startLine, markerLength);
    if (endLine < 0) {
      output.push(node);
      index += 1;
      continue;
    }
    if (detailsMatch) {
      const info = parseSpaceDetails(detailsMatch[2] ?? "");
      const bodyStart = startLine + 1;
      output.push({
        type: "paragraph",
        data: {
          hName: "details",
          hProperties: {
            className: "memoir-details",
            ...(info.open ? { open: true } : {}),
          },
        },
        children: [
          titleNode(info.title || DEFAULT_DETAILS_SUMMARY, "summary", "memoir-details-summary"),
          // Re-parse the raw slice: covers both the blank-line-separated case
          // (siblings exist) and the glued case (everything lives inside the
          // opener paragraph and there are no siblings to keep).
          ...reparseFragment(
            lines.slice(bodyStart, endLine).join("\n"),
            bodyStart,
            lineOffsets[bodyStart] ?? 0,
          ),
        ],
      });
    } else {
      const tabs = parseSpaceTabs(lines, startLine + 1, endLine);
      if (!tabs || !tabs.length) {
        // Malformed block: drop it like inkstone does instead of leaking raw markers.
        index += 1;
        while (index < children.length) {
          const candidate = children[index];
          if (candidate && nodeStartLine(candidate) <= endLine) index += 1;
          else break;
        }
        continue;
      }
      output.push({
        type: "paragraph",
        data: {
          hName: "div",
          hProperties: {
            className: ["memoir-tabs", "memoir-tabs-interactive"],
            dataTabs: "true",
          },
        },
        children: tabs.map((tab, tabIndex) => ({
          type: "paragraph",
          data: {
            hName: "section",
            hProperties: {
              className: "memoir-tab",
              dataTabLabel: tab.title,
              dataTabPanel: String(tabIndex),
              ...(tab.selected ? { dataTabSelected: "true" } : {}),
            },
          },
          children: reparseFragment(
            tab.content,
            tab.contentStartLine,
            lineOffsets[tab.contentStartLine] ?? 0,
          ),
        })),
      });
    }
    // Consume the opener node plus everything up to and including the close.
    index += 1;
    while (index < children.length) {
      const candidate = children[index];
      if (candidate && nodeStartLine(candidate) <= endLine) index += 1;
      else break;
    }
  }
  tree.children = output;
}

function visit(node: MdastNode, parentType: string) {
  if (!node || node.type === "code") return;
  if (node.type === "blockquote") {
    transformCallout(node);
  } else if (node.type === "containerDirective" && parentType === "root") {
    transformContainer(node);
    return;
  }
  const children = node.children;
  if (!children?.length) return;
  for (const child of children) visit(child, node.type);
}

/**
 * Minimal containers for the markdown preview: Obsidian-style callouts
 * (`> [!note] 标题`, optional `+`/`-` fold marker), collapsible details
 * (`:::details{title="..."}` directive or `::: details [标题]` space
 * syntax), and tab groups (directive `::::tabs` + `:::tab{title="..."}`
 * or space-syntax `:::: tabs` + `::: tab-item 标签`). Mirrors
 * remark-wiki-links: a pure mdast → mdast transform. Unknown containers
 * fall through untouched.
 */
export function remarkContainers(): (tree: MdastNode, file?: { value?: unknown }) => void {
  return (tree: MdastNode, file?: { value?: unknown }) => {
    const source = typeof file?.value === "string" ? file.value : "";
    if (tree?.children?.length) {
      if (source) transformSpaceContainers(tree, source.split("\n"));
      for (const child of tree.children) visit(child, "root");
    }
  };
}
