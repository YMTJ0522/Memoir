type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

/** `... ^block-id` at the end of a paragraph/heading line. */
const BLOCK_ID_PATTERN = /(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\s*$/;

/**
 * Strips trailing Obsidian-style block identifiers (`... ^block-id`) from
 * paragraph and heading text and anchors the block for `((block-id))`
 * references: the block's hast element gets `id="^id"` plus
 * `data-block-id="id"` (mirroring inkstone). Duplicate ids get a `-2`, `-3`…
 * suffix so in-page anchors stay unique. The id itself renders nothing; it
 * keeps `[[note#^block-id]]` references copy-compatible with Obsidian vaults.
 */
export function remarkBlockIds() {
  return (tree: MdastNode) => {
    const seen = new Set<string>();
    const children = tree.children;
    if (!children) return;
    for (const node of children) {
      if (node.type !== "paragraph" && node.type !== "heading") continue;
      const last = node.children?.[node.children.length - 1];
      if (!last || last.type !== "text" || !last.value) continue;
      const match = BLOCK_ID_PATTERN.exec(last.value);
      if (!match) continue;
      const original = match[1];
      if (!original) continue;
      let id = original;
      let suffix = 2;
      while (seen.has(id)) id = `${original}-${suffix++}`;
      seen.add(id);
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id: `^${id}`,
          "data-block-id": id,
        },
      };
      const stripped = last.value.slice(0, match.index).trimEnd();
      last.value = stripped;
      if (!last.value) node.children?.pop();
    }
  };
}
