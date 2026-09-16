type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
  data?: Record<string, unknown>;
};

type HastElement = HastNode & { type: "element"; tagName: string; children: HastNode[] };

const isElement = (node: HastNode): node is HastElement =>
  node.type === "element" && typeof node.tagName === "string";

/**
 * Wraps every <table> in a <div class="memoir-table-wrap"> so wide tables
 * scroll horizontally instead of overflowing or getting clipped.
 */
export function rehypeTableWrap() {
  return (tree: HastNode) => {
    walk(tree);
  };
}

function walk(node: HastNode) {
  if (!isElement(node) || !node.children) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (isElement(child) && child.tagName === "table") {
      node.children[i] = {
        type: "element",
        tagName: "div",
        properties: { className: ["memoir-table-wrap"] },
        children: [child],
      };
    } else {
      walk(child);
    }
  }
}
