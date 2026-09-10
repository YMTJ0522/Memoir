import { describe, expect, it } from "vitest";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { remarkTags } from "./remark-tags";

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

function parse(source: string): MdNode {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkTags);
  return processor.runSync(processor.parse(source)) as unknown as MdNode;
}

/** Collects mdast nodes by their eventual hast tag name (data.hName). */
function allByHName(tree: MdNode | undefined, hName: string): MdNode[] {
  if (!tree) return [];
  const hits: MdNode[] = [];
  if (tree.data?.hName === hName) hits.push(tree);
  for (const child of tree.children || []) hits.push(...allByHName(child, hName));
  return hits;
}

function serialize(node: MdNode | undefined): string {
  if (!node) return "";
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value || "";
  return (node.children || []).map(serialize).join("");
}

describe("remarkTags inline tags", () => {
  it("converts a leading #标签 into an inline-tag span", () => {
    const tree = parse("#工作 笔记内容\n");
    const tag = allByHName(tree, "span")[0];
    expect(tag).toBeDefined();
    expect(tag?.data?.hProperties?.["data-tag"]).toBe("工作");
    expect(tag?.data?.hProperties?.className).toBe("inline-tag");
    expect(serialize(tag)).toBe("#工作");
  });

  it("converts a tag after whitespace inside a sentence", () => {
    const tree = parse("今天讨论了 #金融科技 的话题\n");
    const tag = allByHName(tree, "span")[0];
    expect(tag?.data?.hProperties?.["data-tag"]).toBe("金融科技");
  });

  it("keeps a tag after CJK opening punctuation", () => {
    const tree = parse("（#投标）商机\n");
    const tag = allByHName(tree, "span")[0];
    expect(tag?.data?.hProperties?.["data-tag"]).toBe("投标");
  });

  it("ignores # inside a URL-like token (no preceding space)", () => frag());

  function frag() {
    const tree = parse("见 https://example.com/page#section 说明\n");
    expect(allByHName(tree, "span")).toHaveLength(0);
  }

  it("ignores # without a name (whitespace after #)", () => {
    const tree = parse("a # b\n");
    expect(allByHName(tree, "span")).toHaveLength(0);
  });

  it("ignores a bare # at line end", () => {
    const tree = parse("count to #\n");
    expect(allByHName(tree, "span")).toHaveLength(0);
  });

  it("stops the tag name at CJK punctuation and keeps trailing text", () => {
    const tree = parse("讨论 #评审，第二段\n");
    const tag = allByHName(tree, "span")[0];
    expect(tag?.data?.hProperties?.["data-tag"]).toBe("评审");
    expect(serialize(tree)).toContain("，第二段");
  });

  it("does not convert tags inside inline code", () => {
    const tree = parse("run `echo #tag` now\n");
    expect(allByHName(tree, "span")).toHaveLength(0);
  });

  it("does not convert tags inside code blocks", () => {
    const tree = parse("```\n#heading\n```\n");
    expect(allByHName(tree, "span")).toHaveLength(0);
  });

  it("keeps headings (ATX marker) as headings, not tags", () => {
    const tree = parse("# 标题\n");
    expect(allByHName(tree, "span")).toHaveLength(0);
  });
});

describe("remarkTags block references", () => {
  it("converts ((id)) into a block-reference anchor", () => {
    const tree = parse("见 ((abc123)) 的引用\n");
    const anchor = allByHName(tree, "a")[0];
    expect(anchor).toBeDefined();
    expect(anchor?.data?.hProperties?.["data-block-ref"]).toBe("abc123");
    expect(anchor?.data?.hProperties?.href).toBe("#%5Eabc123");
    expect(anchor?.data?.hProperties?.className).toBe("block-reference");
    expect(serialize(anchor)).toBe("((abc123))");
  });

  it("supports dashes and underscores in ids", () => {
    const tree = parse("((Block-ID_9))\n");
    const anchor = allByHName(tree, "a")[0];
    expect(anchor?.data?.hProperties?.["data-block-ref"]).toBe("Block-ID_9");
  });

  it("rejects ids starting with a non-alphanumeric char", () => {
    const tree = parse("((_abc))\n");
    expect(allByHName(tree, "a")).toHaveLength(0);
  });

  it("rejects overly long ids (>64 chars)", () => {
    const longId = "a".repeat(65);
    const tree = parse(`((${longId}))\n`);
    expect(allByHName(tree, "a")).toHaveLength(0);
  });

  it("accepts an id at the 64-char limit", () => {
    const id = "a".repeat(64);
    const tree = parse(`((${id}))\n`);
    const anchor = allByHName(tree, "a")[0];
    expect(anchor?.data?.hProperties?.["data-block-ref"]).toBe(id);
  });

  it("leaves single parentheses untouched", () => {
    const tree = parse("函数 (foo) 调用\n");
    expect(allByHName(tree, "a")).toHaveLength(0);
  });
});

describe("remarkTags combinations", () => {
  it("handles a tag and a reference in one paragraph", () => {
    const tree = parse("#需求 见 ((root1))\n");
    const tags = allByHName(tree, "span");
    const anchors = allByHName(tree, "a");
    expect(tags).toHaveLength(1);
    expect(tags[0]?.data?.hProperties?.["data-tag"]).toBe("需求");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.data?.hProperties?.["data-block-ref"]).toBe("root1");
  });

  it("does not treat ((id)) content as a tag", () => {
    const tree = parse("((abc)) #def\n");
    const tags = allByHName(tree, "span");
    const anchors = allByHName(tree, "a");
    expect(anchors).toHaveLength(1);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.data?.hProperties?.["data-tag"]).toBe("def");
  });

  it("serializes the paragraph with markers preserved", () => {
    const tree = parse("#工作 与 ((root1)) 引用\n");
    expect(serialize(tree)).toBe("#工作 与 ((root1)) 引用");
  });
});
