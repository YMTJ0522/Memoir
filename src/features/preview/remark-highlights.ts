type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: unknown[];
  };
};

const HIGHLIGHT_PATTERN = /==([^=\n]+)==/;

/**
 * Minimal `==highlight==` support for the preview. Mirrors remark-wiki-links:
 * splits text nodes so `==text==` becomes a <mark data-highlight> element.
 * Skips code blocks and inline code.
 */
export function remarkHighlights() {
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
      const parts = splitHighlightText(child.value);
      if (parts.length !== 1 || parts[0]?.type !== "text" || parts[0].value !== child.value) {
        children.splice(index, 1, ...parts);
      }
      continue;
    }
    visit(child);
  }
}

function splitHighlightText(value: string): MdastNode[] {
  const parts: MdastNode[] = [];
  const pattern = new RegExp(HIGHLIGHT_PATTERN.source, "g");
  let last = 0;
  let match = pattern.exec(value);
  while (match) {
    const index = match.index;
    if (index > last) {
      parts.push({ type: "text", value: value.slice(last, index) });
    }
    parts.push({
      type: "emphasis",
      data: {
        hName: "mark",
        hProperties: { "data-highlight": "" },
      },
      children: [{ type: "text", value: match[1] ?? "" }],
    });
    last = index + match[0].length;
    match = pattern.exec(value);
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts.length ? parts : [{ type: "text", value }];
}
