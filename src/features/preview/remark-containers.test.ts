import { describe, expect, it } from "vitest";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseCalloutMarker, remarkContainers } from "./remark-containers";
import { remarkBlockIds } from "./remark-block-ids";

type MdNode = {
  type: string;
  name?: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

function parse(source: string): MdNode {
  const processor = unified().use(remarkParse).use(remarkDirective).use(remarkContainers).use(remarkBlockIds);
  // runSync(tree, vfile) — the space-syntax transform reads file.value.
  return processor.runSync(processor.parse(source), { value: source }) as unknown as MdNode;
}

function firstNode(tree: MdNode, type: string): MdNode | undefined {
  if (tree.type === type) return tree;
  for (const child of tree.children || []) {
    const hit = firstNode(child, type);
    if (hit) return hit;
  }
  return undefined;
}

function firstNodeByHName(tree: MdNode | undefined, hName: string): MdNode | undefined {
  if (!tree) return undefined;
  if (tree.data?.hName === hName) return tree;
  for (const child of tree.children || []) {
    const hit = firstNodeByHName(child, hName);
    if (hit) return hit;
  }
  return undefined;
}

function allNodesByHName(tree: MdNode | undefined, hName: string): MdNode[] {
  if (!tree) return [];
  const hits: MdNode[] = [];
  if (tree.data?.hName === hName) hits.push(tree);
  for (const child of tree.children || []) hits.push(...allNodesByHName(child, hName));
  return hits;
}

function serialize(node: MdNode | undefined): string {
  if (!node) return "";
  if (node.type === "text" || node.type === "code" || node.type === "inlineCode") return node.value || "";
  return (node.children || []).map(serialize).join("");
}

describe("parseCalloutMarker", () => {
  it("parses a plain marker with no title", () => {
    expect(parseCalloutMarker("[!note]")).toEqual({ type: "note", title: "", fold: "" });
  });

  it("parses a title and preserves case", () => {
    expect(parseCalloutMarker("[!tip] 存钱建议")).toEqual({ type: "tip", title: "存钱建议", fold: "" });
  });

  it("normalizes aliases and captures the fold marker", () => {
    expect(parseCalloutMarker("[!ERROR]-")).toEqual({ type: "danger", title: "", fold: "-" });
  });

  it("rejects plain blockquotes", () => {
    expect(parseCalloutMarker("普通引用")).toBeNull();
  });
});

describe("remarkContainers callouts", () => {
  it("renders a note callout with a custom title", () => {
    const tree = parse("> [!note] 注意\n> 内容\n");
    const aside = firstNodeByHName(tree, "aside");
    expect(aside).toBeTruthy();
    expect(aside?.data?.hProperties?.dataCallout).toBe("note");
    expect(serialize(aside)).toContain("注意");
    expect(serialize(aside)).toContain("内容");
  });

  it("falls back to the default title per type", () => {
    const tree = parse("> [!tip]\n> 存钱建议\n");
    const aside = firstNodeByHName(tree, "aside");
    expect(aside?.data?.hProperties?.dataCallout).toBe("tip");
    expect(serialize(aside)).toContain("TIP");
  });

  it("renders foldable callouts as details with the open attribute", () => {
    const tree = parse("> [!warning]+ 关键提醒\n> 内容\n");
    const details = firstNodeByHName(tree, "details");
    expect(details).toBeTruthy();
    expect(details?.data?.hProperties?.dataCallout).toBe("warning");
    expect(details?.data?.hProperties?.open).toBe(true);
    expect(serialize(details)).toContain("关键提醒");
  });

  it("normalizes aliases to known types", () => {
    const tree = parse("> [!hint] 小技巧\n> 内容\n");
    const aside = firstNodeByHName(tree, "aside");
    expect(aside?.data?.hProperties?.dataCallout).toBe("tip");
  });

  it("leaves plain blockquotes untouched", () => {
    const tree = parse("> 普通引用\n");
    expect(firstNodeByHName(tree, "aside")).toBeUndefined();
    expect(firstNode(tree, "blockquote")).toBeTruthy();
  });
});

describe("remarkContainers details", () => {
  it("renders a collapsible details block from the title attribute", () => {
    const tree = parse(':::details{title="展开看看"}\n- 一\n- 二\n:::\n');
    const details = firstNodeByHName(tree, "details");
    expect(details).toBeTruthy();
    const summary = firstNodeByHName(tree, "summary");
    expect(summary).toBeTruthy();
    expect(serialize(summary)).toContain("展开看看");
  });

  it("falls back to the default summary", () => {
    const tree = parse(":::details\n正文\n:::\n");
    const summary = firstNodeByHName(tree, "summary");
    expect(serialize(summary)).toContain("详情");
  });
});

describe("remarkContainers tabs (directive syntax)", () => {
  it("renders interactive tab sections with labels", () => {
    const tree = parse(
      '::::tabs\n:::tab{title="标签一"}\n内容一\n:::\n:::tab{title="标签二"}\n内容二\n:::\n::::\n',
    );
    const tabs = firstNodeByHName(tree, "div");
    expect(tabs).toBeTruthy();
    expect(tabs?.data?.hProperties?.dataTabs).toBe("true");
    const text = serialize(tabs);
    expect(text).toContain("内容一");
    expect(text).toContain("内容二");
    const sections = allNodesByHName(tabs, "section");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.data?.hProperties?.dataTabLabel).toBe("标签一");
    expect(sections[0]?.data?.hProperties?.dataTabPanel).toBe("0");
    expect(sections[1]?.data?.hProperties?.dataTabLabel).toBe("标签二");
    expect(sections[1]?.data?.hProperties?.dataTabPanel).toBe("1");
  });

  it("falls back to numbered tab labels when titles are missing", () => {
    const tree = parse("::::tabs\n:::tab\n内容\n:::\n::::\n");
    const tabs = firstNodeByHName(tree, "div");
    expect(allNodesByHName(tabs, "section")[0]?.data?.hProperties?.dataTabLabel).toBe("标签 1");
  });
});

describe("remarkContainers space-syntax details", () => {
  it("renders a details block with blank-line separated content", () => {
    const tree = parse("::: details [安装步骤]\n\n第一步内容\n\n:::\n");
    const details = firstNodeByHName(tree, "details");
    expect(details).toBeTruthy();
    const summary = firstNodeByHName(details, "summary");
    expect(serialize(summary)).toBe("安装步骤");
    expect(serialize(details)).toContain("第一步内容");
  });

  it("renders glued content that remark folds into the opener paragraph", () => {
    const tree = parse("::: details 说明\n内容行\n:::\n");
    const details = firstNodeByHName(tree, "details");
    expect(details).toBeTruthy();
    expect(serialize(details)).toContain("内容行");
  });

  it("keeps code fences inside the container body", () => {
    const tree = parse("::: details 代码\n```js\nconst a = 1;\n```\n:::\n");
    const details = firstNodeByHName(tree, "details");
    expect(details).toBeTruthy();
    expect(serialize(details)).toContain("const a = 1;");
  });

  it("marks open/+ prefixed details open", () => {
    const tree = parse("::: details open 默认展开\n内容\n:::\n");
    const details = firstNodeByHName(tree, "details");
    expect(details?.data?.hProperties?.open).toBe(true);
  });

  it("restores source positions for re-parsed content", () => {
    type PositionedNode = MdNode & {
      children?: Array<MdNode & { position?: { start?: { line?: number; offset?: number } } }>;
      position?: { start?: { line?: number; offset?: number } };
    };
    const tree = parse("::: details 说明\n内容行\n:::\n") as MdNode & { children?: PositionedNode[] };
    const details = tree.children?.[0];
    const body = details?.children?.[1] as PositionedNode | undefined;
    expect(body?.position?.start?.line).toBe(2);
    expect(body?.position?.start?.offset).toBe("::: details 说明\n".length);
  });

  it("keeps unclosed markers as plain paragraphs", () => {
    const tree = parse("::: details 未闭合\n内容\n");
    expect(firstNodeByHName(tree, "details")).toBeUndefined();
    expect(serialize(tree)).toContain(":::");
  });
});

describe("remarkContainers space-syntax tabs", () => {
  it("renders tab sections from toolbar output", () => {
    const tree = parse(
      ":::: tabs\n::: tab-item 标签一\n\n内容一\n\n:::\n::: tab-item 标签二\n\n内容二\n\n:::\n::::\n",
    );
    const tabs = firstNodeByHName(tree, "div");
    expect(tabs?.data?.hProperties?.dataTabs).toBe("true");
    const sections = allNodesByHName(tabs, "section");
    expect(sections).toHaveLength(2);
    expect(sections[0]?.data?.hProperties?.dataTabLabel).toBe("标签一");
    expect(sections[0]?.data?.hProperties?.dataTabPanel).toBe("0");
    expect(serialize(sections[0])).toContain("内容一");
    expect(serialize(sections[1])).toContain("内容二");
  });

  it("marks the :selected: tab", () => {
    const tree = parse(
      ":::: tabs\n::: tab-item 甲\n\n内容甲\n\n:::\n::: tab-item 乙\n:selected:\n\n内容乙\n\n:::\n::::\n",
    );
    const sections = allNodesByHName(firstNodeByHName(tree, "div"), "section");
    expect(sections[0]?.data?.hProperties?.dataTabSelected).toBeUndefined();
    expect(sections[1]?.data?.hProperties?.dataTabSelected).toBe("true");
  });

  it("drops malformed tab blocks instead of leaking raw markers", () => {
    const tree = parse(":::: tabs\n内容\n::::\n");
    expect(serialize(tree)).not.toContain("::::");
  });
});

describe("remarkBlockIds", () => {
  it("strips trailing block ids from paragraphs and anchors them", () => {
    const tree = parse("一段文字 ^block-1\n");
    const paragraph = tree.children?.[0];
    expect(serialize(paragraph)).not.toContain("^block-1");
    expect(serialize(paragraph)).toContain("一段文字");
    expect(paragraph?.data?.hProperties?.id).toBe("^block-1");
    expect(paragraph?.data?.hProperties?.["data-block-id"]).toBe("block-1");
  });

  it("strips trailing block ids from headings", () => {
    const tree = parse("# 标题 ^my-id\n");
    const heading = tree.children?.[0];
    expect(heading?.type).toBe("heading");
    expect(serialize(heading)).toBe("标题");
    expect(heading?.data?.hProperties?.id).toBe("^my-id");
  });

  it("suffixes duplicate block ids", () => {
    const tree = parse("第一段 ^dup\n\n第二段 ^dup\n");
    const paragraphs = tree.children?.filter((node) => node.type === "paragraph") || [];
    expect(paragraphs[0]?.data?.hProperties?.id).toBe("^dup");
    expect(paragraphs[1]?.data?.hProperties?.id).toBe("^dup-2");
  });

  it("keeps carets that are not block ids", () => {
    const tree = parse("数学 a^2 + b^2\n");
    expect(serialize(tree.children?.[0])).toContain("a^2 + b^2");
  });
});
