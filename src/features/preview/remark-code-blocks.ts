/**
 * Enhanced code fences for the markdown preview (inkstone parity): a header
 * bar (title / language badge / copy button), optional line numbers and
 * highlighted lines. Everything is derived from the fence info string.
 *
 * The mdast → hast conversion (`mdast-util-to-hast`) applies `data.hName` /
 * `data.hProperties` to the *inner* `code` element before wrapping it in the
 * outer `pre`, so setting them from remark would rename the code element and
 * clobber its `language-*` class (breaking rehype-highlight). Instead the
 * remark pass only tags fenced code nodes with the raw meta string, and the
 * rehype pass (`rehypeMemoirCodeBlocks`, runs before rehype-highlight) moves
 * it onto the outer `pre` as inkstone-style data attributes.
 */

type MdastNode = {
  type: string;
  value?: string;
  lang?: string;
  meta?: string | null;
  position?: {
    start?: { offset?: number };
  };
  children?: MdastNode[];
  data?: {
    hProperties?: Record<string, unknown>;
  };
};

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
};

type HastElement = HastNode & { type: "element"; tagName: string; children: HastNode[] };

const isElement = (node: HastNode): node is HastElement =>
  node.type === "element" && typeof node.tagName === "string";

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : []);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.trunc(value) : min));

const RESERVED_CODE_CLASSES = new Set(["numberlines", "line-numbers", "linenos"]);
const isReservedCodeClass = (value: string) => RESERVED_CODE_CLASSES.has(value.toLowerCase());

function codeMetadataValue(source: string, ...names: string[]): string | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const pattern = /(?:^|\s)([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  for (const match of source.matchAll(pattern)) {
    if (wanted.has((match[1] ?? "").toLowerCase())) {
      return (match[2] ?? match[3] ?? match[4] ?? "").slice(0, 512);
    }
  }
  return null;
}

/** `1` / `a-b` line specs, clamped like inkstone (max 200 parts). */
function parseLineSpec(source: string): number[] {
  const lines = new Set<number>();
  for (const part of source.split(/[ ,]+/).filter(Boolean).slice(0, 200)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const from = clamp(Number(range[1]), 1, 100000);
      const to = clamp(Number(range[2]), from, Math.min(100000, from + 1000));
      for (let line = from; line <= to; line++) lines.add(line);
    } else if (/^\d+$/.test(part)) {
      lines.add(clamp(Number(part), 1, 100000));
    }
  }
  return [...lines];
}

export type FenceInfo = {
  language: string;
  title: string;
  lineNumbers: boolean;
  startLine: number;
  highlightedLines: number[];
};

/** Full parity with inkstone's `parseFenceInfo` (renderer.ts). */
export function parseFenceInfo(source: string): FenceInfo {
  let rest = source.trim();
  let language = "";
  let title = "";
  let lineNumbers = false;
  let startLine = 1;
  const highlighted = new Set<number>();

  const leadingCodeOptions = /^\{([^{}]+)\}/.exec(rest);
  if (leadingCodeOptions && !/^\d[\d,\s-]*$/.test((leadingCodeOptions[1] ?? "").trim())) {
    const options = leadingCodeOptions[1] ?? "";
    const classes = [...options.matchAll(/(?:^|\s)\.([A-Za-z][\w-]{0,63})/g)].map((match) => match[1] ?? "");
    language = classes.find((className) => !isReservedCodeClass(className))?.toLowerCase() ?? "";
    lineNumbers = classes.some(isReservedCodeClass);
    title = codeMetadataValue(options, "title") ?? "";
    const startAttribute = codeMetadataValue(options, "start", "startfrom");
    if (startAttribute && /^\d+$/.test(startAttribute)) startLine = clamp(Number(startAttribute), 1, 100000);
    const highlightAttribute = codeMetadataValue(options, "hl_lines", "highlight");
    if (highlightAttribute) parseLineSpec(highlightAttribute).forEach((line) => highlighted.add(line));
    rest = rest.slice(leadingCodeOptions[0].length).trim();
  }
  if (!language) {
    const lang = /^([^\s{]+)/.exec(rest);
    if (lang) {
      language = (lang[1] ?? "").toLowerCase();
      rest = rest.slice(lang[0].length).trim();
    }
  }
  const titleMatch = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|([^\s]+))/.exec(rest);
  if (titleMatch) title = titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? "";
  const bracketTitle = /(?:^|\s)\[([^\]\n]+)\]/.exec(rest);
  if (!title && bracketTitle) title = (bracketTitle[1] ?? "").trim();
  lineNumbers = lineNumbers || /(?:^|\s)(?:line-numbers|linenos|numberLines)(?=\s|$)/.test(rest);
  const start = /(?:^|\s)(?:start|startFrom)=(?:"(\d+)"|'(\d+)'|(\d+))/.exec(rest);
  if (start) startLine = clamp(Number(start[1] ?? start[2] ?? start[3]), 1, 100000);
  const highlight = /(?:^|\s)\{(\d[\d,\s-]*)\}/.exec(rest);
  if (highlight) parseLineSpec(highlight[1] ?? "").forEach((line) => highlighted.add(line));
  const highlightNamed = /(?:^|\s)(?:hl_lines|highlight)=(?:"([^"]*)"|'([^']*)'|([^\s]+))/.exec(rest);
  if (highlightNamed) {
    parseLineSpec(highlightNamed[1] ?? highlightNamed[2] ?? highlightNamed[3] ?? "").forEach((line) =>
      highlighted.add(line),
    );
  }
  return {
    language,
    title,
    lineNumbers,
    startLine,
    highlightedLines: [...highlighted].sort((a, b) => a - b),
  };
}

const MEMOIR_META_PROPERTY = "dataMemoirMeta";

/**
 * Tags fenced code nodes (``` / ~~~, verified against the raw source so
 * indented code stays untouched) with their fence meta. Mermaid is skipped —
 * the preview hands those fences to the diagram renderer. Inkstone renders
 * the `.code-block` header for *every* fence, meta or not.
 */
export function remarkCodeBlocks() {
  return (tree: MdastNode, file?: { value?: unknown }) => {
    const source = typeof file?.value === "string" ? file.value : null;
    const visit = (node: MdastNode) => {
      if (node.type === "code" && node.lang !== "mermaid") {
        const startOffset = node.position?.start?.offset;
        const isFenced = !source || typeof startOffset !== "number" || source.startsWith("```", startOffset) || source.startsWith("~~~", startOffset);
        if (isFenced) {
          node.data = {
            ...node.data,
            hProperties: {
              ...node.data?.hProperties,
              [MEMOIR_META_PROPERTY]: node.meta ?? "",
            },
          };
          return;
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function readLanguageClass(value: unknown): string {
  for (const item of asArray(value)) {
    const name = String(item);
    if (name.startsWith("language-")) return name.slice("language-".length).toLowerCase();
  }
  return "";
}

/**
 * Moves the tagged fence meta from the inner `code` element onto the outer
 * `pre` as data attributes (inkstone `.code-block` shape). Must run before
 * rehype-highlight: it only reads, never rewrites, the `code` element, so
 * syntax highlighting is unaffected.
 */
export function rehypeMemoirCodeBlocks() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (!isElement(node)) return;
      if (node.tagName === "pre") {
        const code = (node.children ?? []).find((child): child is HastElement => isElement(child) && child.tagName === "code");
        if (code && typeof code.properties?.[MEMOIR_META_PROPERTY] === "string") {
          const meta = String(code.properties[MEMOIR_META_PROPERTY]);
          delete code.properties[MEMOIR_META_PROPERTY];
          const info = parseFenceInfo(meta);
          // Inkstone: the parsed fence language wins over `{...}` classes.
          const language = readLanguageClass(code.properties?.className) || info.language;
          node.properties = {
            ...node.properties,
            className: [...asArray(node.properties?.className), "memoir-code-block"],
            dataLang: language,
            dataCodeStart: String(info.startLine),
            ...(info.title ? { dataCodeTitle: info.title } : {}),
            ...(info.lineNumbers ? { dataLineNumbers: "true" } : {}),
            ...(info.highlightedLines.length ? { dataHighlightLines: info.highlightedLines.join(",") } : {}),
          };
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
