import { describe, expect, it } from "vitest";
import {
  applyHeadingEdit,
  extractMindHeadings,
  headingsToMarkdown,
} from "./mindmap-editing";

const SAMPLE = `---
title: Demo
tags: [a, b]
---
# 一级标题

正文段落，不是标题。

## 二级标题 A

### 三级标题 X

## 二级标题 B

\`\`\`
# 代码块里的标题
\`\`\`

### 二级标题 B 下的三级
`;

describe("extractMindHeadings", () => {
  it("extracts headings with their original line numbers", () => {
    const headings = extractMindHeadings(SAMPLE);
    expect(headings).toEqual([
      { depth: 1, text: "一级标题", line: 4 },
      { depth: 2, text: "二级标题 A", line: 8 },
      { depth: 3, text: "三级标题 X", line: 10 },
      { depth: 2, text: "二级标题 B", line: 12 },
      { depth: 3, text: "二级标题 B 下的三级", line: 18 },
    ]);
  });

  it("skips headings inside fenced code blocks", () => {
    const content = "# 真标题\n\n```\n# 假标题\n```\n\n## 真标题二\n";
    const headings = extractMindHeadings(content);
    expect(headings.map((h) => h.text)).toEqual(["真标题", "真标题二"]);
  });

  it("handles inline markers and empty text", () => {
    const content = "# **加粗**标题\n\n#  \n\n## 你好 `code`\n";
    const headings = extractMindHeadings(content);
    expect(headings.map((h) => ({ depth: h.depth, text: h.text }))).toEqual([
      { depth: 1, text: "加粗标题" },
      { depth: 2, text: "你好 code" },
    ]);
  });

  it("unescapes backslash-escaped punctuation in headings", () => {
    const content = "# 7\\.5 小节\n\n## Linux\\(入门\\)\n\n### 1\\.1 什么是 Linux\n";
    const headings = extractMindHeadings(content);
    expect(headings.map((h) => h.text)).toEqual([
      "7.5 小节",
      "Linux(入门)",
      "1.1 什么是 Linux",
    ]);
  });
});

describe("headingsToMarkdown", () => {
  it("builds a heading-only markdown for the markmap transformer", () => {
    const md = headingsToMarkdown([
      { depth: 1, text: "根", line: 0 },
      { depth: 2, text: "子", line: 1 },
      { depth: 3, text: "孙", line: 2 },
    ]);
    expect(md).toBe("# 根\n## 子\n### 孙");
  });
});

describe("applyHeadingEdit", () => {
  const doc = "# 标题一\n\n正文\n\n## 子标题\n\n### 孙标题\n";

  it("renames a heading in place", () => {
    const next = applyHeadingEdit(doc, { kind: "rename", line: 4, text: "子标题改名" });
    expect(next).toContain("## 子标题改名");
    expect(next).not.toContain("## 子标题\n");
    expect(next).toContain("### 孙标题");
  });

  it("indents a heading (adds one #)", () => {
    const next = applyHeadingEdit(doc, { kind: "indent", line: 4 });
    expect(next).toContain("### 子标题");
  });

  it("does not indent a level-6 heading", () => {
    const six = "###### 最深\n";
    expect(applyHeadingEdit(six, { kind: "indent", line: 0 })).toBe(six);
  });

  it("outdents a heading (removes one #)", () => {
    const next = applyHeadingEdit(doc, { kind: "outdent", line: 4 });
    expect(next).toContain("# 子标题");
  });

  it("does not outdent a level-1 heading", () => {
    const one = "# 标题\n";
    expect(applyHeadingEdit(one, { kind: "outdent", line: 0 })).toBe(one);
  });

  it("deletes a heading line", () => {
    const next = applyHeadingEdit(doc, { kind: "delete", line: 4 });
    expect(next).not.toContain("子标题");
    expect(next).toContain("### 孙标题");
    expect(next).toContain("# 标题");
  });

  it("inserts a new heading after the target line", () => {
    const next = applyHeadingEdit(doc, { kind: "insert", line: 4, text: "新节点", level: 3 });
    const lines = next.split("\n");
    // 在 ## 子标题 之后插入 ### 新节点
    const idx = lines.findIndex((line) => line.startsWith("## 子标题"));
    expect(lines[idx + 1]).toBe("### 新节点");
  });

  it("preserves a trailing newline", () => {
    const next = applyHeadingEdit(doc, { kind: "rename", line: 0, text: "改名" });
    expect(next.endsWith("\n")).toBe(true);
  });

  it("is a no-op on non-heading lines", () => {
    expect(applyHeadingEdit(doc, { kind: "rename", line: 2, text: "x" })).toBe(doc);
  });
});