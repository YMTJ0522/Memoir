type MdastNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: unknown[];
  };
};

/**
 * `#标签` — must be preceded by whitespace, line start, or CJK punctuation
 * (mirrors inkstone's inline-tag rule so URLs like `file#frag` stay plain).
 */
const TAG_RE = /#([\p{L}\p{N}_\-/·]{1,60})(?![\p{L}\p{N}_\-/·])/u;
/** `((块引用))` — the id pattern follows inkstone's block_reference rule. */
const BLOCK_REF_RE = /\(\(([A-Za-z0-9][A-Za-z0-9_-]{0,63})\)\)/;

/** Chars allowed before a tag: whitespace, `#` at start, CJK punctuation. */
const TAG_PRECEDING = /[\s（【>「『，、；]/;

/**
 * Minimal inline-tag (`#标签`) and block-reference (`((id))`) support for the
 * preview. Mirrors remark-wiki-links: splits text nodes so tags become
 * clickable `<span class="inline-tag" data-tag>` elements and references
 * become `<a class="block-reference" data-block-ref href="#%5Eid">` anchors
 * that jump to the anchored block (see remark-block-ids). Skips code blocks
 * and inline code.
 */
export function remarkTags() {
  return (tree: MdastNode) => {
    visit(tree);
  };
}

function visit(node: MdastNode) {
  if (node.type === "code" || node.type === "inlineCode") return;
  const children = node.children;
  if (!children?.length) return;
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child.type === "text" && child.value) {
      const parts = splitTagText(child.value);
      if (parts.length !== 1 || parts[0]?.type !== "text" || parts[0].value !== child.value) {
        children.splice(index, 1, ...parts);
      }
      continue;
    }
    visit(child);
  }
}

/**
 * Splits a text value into literal text, tag spans and block-reference
 * anchors. Tag detection uses the full-document context via the `preceding`
 * char (the caller walks the paragraph text); block references are
 * position-independent.
 */
function splitTagText(value: string): MdastNode[] {
  const parts: MdastNode[] = [];
  const tagPattern = new RegExp(TAG_RE.source, "gu");
  const refPattern = new RegExp(BLOCK_REF_RE.source, "g");
  type Hit = { start: number; end: number; kind: "tag" | "ref"; payload: string };
  const hits: Hit[] = [];
  for (const match of value.matchAll(refPattern)) {
    const id = match[1];
    if (!id) continue;
    hits.push({ start: match.index, end: match.index + match[0].length, kind: "ref", payload: id });
  }
  for (const match of value.matchAll(tagPattern)) {
    const start = match.index;
    const name = match[1];
    if (!name) continue;
    if (start > 0 && !TAG_PRECEDING.test(value[start - 1] ?? "")) continue;
    if (hits.some((hit) => start < hit.end && start + match[0].length > hit.start)) continue;
    hits.push({ start, end: start + match[0].length, kind: "tag", payload: name });
  }
  if (!hits.length) return [{ type: "text", value }];
  hits.sort((a, b) => a.start - b.start);
  let last = 0;
  for (const hit of hits) {
    if (hit.start < last) continue;
    if (hit.start > last) parts.push({ type: "text", value: value.slice(last, hit.start) });
    if (hit.kind === "tag") {
      parts.push({
        type: "emphasis",
        data: {
          hName: "span",
          hProperties: {
            className: "inline-tag",
            "data-tag": hit.payload,
            role: "link",
            tabIndex: 0,
          },
        },
        children: [{ type: "text", value: `#${hit.payload}` }],
      });
    } else {
      parts.push({
        type: "link",
        url: `#%5E${hit.payload}`,
        data: {
          hName: "a",
          hProperties: {
            className: "block-reference",
            "data-block-ref": hit.payload,
            href: `#%5E${hit.payload}`,
          },
        },
        children: [{ type: "text", value: `((${hit.payload}))` }],
      });
    }
    last = hit.end;
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts.length ? parts : [{ type: "text", value }];
}
