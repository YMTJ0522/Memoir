import { splitHash } from "../../domain/note-links";

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  url?: string;
  title?: string | null;
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

export const WIKI_LINK_PROTOCOL = "#memoir-note/";

export const WIKI_EMBED_DATA_ATTRIBUTE = "data-memoir-wiki-embed";

/** Reads the raw `![[...]]` inner reference carried by an embed host span. */
export function readWikiEmbedProp(props: Record<string, unknown>) {
  const node = props.node;
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const value =
    props[WIKI_EMBED_DATA_ATTRIBUTE] ??
    props.dataMemoirWikiEmbed ??
    nodeProperties[WIKI_EMBED_DATA_ATTRIBUTE] ??
    nodeProperties.dataMemoirWikiEmbed;
  return typeof value === "string" ? value : null;
}

export function wikiHref(inner: string) {
  return `${WIKI_LINK_PROTOCOL}${encodeURIComponent(inner)}`;
}

export function wikiInnerFromHref(href: string) {
  if (!href.startsWith(WIKI_LINK_PROTOCOL)) return null;
  try {
    return decodeURIComponent(href.slice(WIKI_LINK_PROTOCOL.length));
  } catch {
    return href.slice(WIKI_LINK_PROTOCOL.length);
  }
}

export function wikiDisplayText(inner: string) {
  const pipe = inner.indexOf("|");
  if (pipe >= 0) {
    const alias = inner.slice(pipe + 1).trim();
    if (alias) return alias;
  }
  const target = (pipe < 0 ? inner : inner.slice(0, pipe)).trim();
  const { path, heading } = splitHash(target);
  const name = path.split("/").pop()?.replace(/\.(md|mdx)$/i, "") || path;
  return heading ? `${name}#${heading}` : name;
}

/**
 * Minimal `[[wiki link]]` and `![[note embed]]` support for the preview.
 * Splits text nodes so `[[text]]` becomes a wiki link element and
 * `![[note]]` becomes a span host carrying the raw inner reference in
 * `data-memoir-wiki-embed` (rendered as a note card by WikiEmbed).
 * Skips code blocks and inline code.
 */
export function remarkWikiLinks() {
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
      const parts = splitWikiText(child.value);
      if (parts.length !== 1 || parts[0]?.type !== "text" || parts[0].value !== child.value) {
        children.splice(index, 1, ...parts);
      }
      continue;
    }
    visit(child);
  }
}

/**
 * `![[note]]` embeds render as a clickable card pointing at the target
 * note; the actual content is loaded by the WikiEmbed React component.
 */
function splitWikiText(value: string): MdastNode[] {
  const parts: MdastNode[] = [];
  const pattern = /(!?)\[\[([^\[\]]+)\]\]/g;
  let last = 0;
  let match = pattern.exec(value);
  while (match) {
    const index = match.index;
    const embed = match[1] === "!";
    if (index > last) {
      parts.push({ type: "text", value: value.slice(last, index) });
    }
    const inner = match[2] || "";
    if (embed) {
      parts.push({
        type: "wikiEmbed",
        data: {
          hName: "span",
          hProperties: {
            className: ["memoir-wiki-embed-host"],
            dataMemoirWikiEmbed: inner,
          },
        },
        children: [],
      });
    } else {
      parts.push({
        type: "link",
        url: wikiHref(inner),
        title: null,
        children: [{ type: "text", value: wikiDisplayText(inner) }],
        data: { hProperties: { className: ["wiki-link"] } },
      });
    }
    last = index + match[0].length;
    match = pattern.exec(value);
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts.length ? parts : [{ type: "text", value }];
}
