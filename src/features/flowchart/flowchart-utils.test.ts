import { describe, expect, it } from "vitest";
import { extractMermaidBlocks, mermaidBlockLabel } from "./flowchart-utils";

const NOTE = `# 标题

正文。

\`\`\`mermaid
flowchart TD
  A[开始] --> B{判断}
  B -->|是| C[结束]
  B -->|否| A
\`\`\`

中间段落。

\`\`\`ts
const x = 1;
\`\`\`

\`\`\`mermaid
sequenceDiagram
  用户->>服务: 请求
\`\`\`
`;

describe("extractMermaidBlocks", () => {
  it("extracts mermaid fences in order with content", () => {
    const blocks = extractMermaidBlocks(NOTE);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].code).toContain("flowchart TD");
    expect(blocks[0].code).toContain("B -->|是| C[结束]");
    expect(blocks[1].code).toContain("sequenceDiagram");
  });

  it("skips non-mermaid fences", () => {
    const blocks = extractMermaidBlocks(NOTE);
    expect(blocks.every((block) => block.info === "mermaid")).toBe(true);
    expect(blocks.some((block) => block.code.includes("const x"))).toBe(false);
  });

  it("ignores fences inside code blocks", () => {
    const content = "```\n```mermaid\nflowchart TD\n```\n";
    // The outer fence opens, ```mermaid is content inside, then the first
    // closing fence ends it — no standalone mermaid fence exists.
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(0);
  });

  it("supports tilde fences", () => {
    const content = "~~~mermaid\npie\n  \"A\": 1\n~~~\n";
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe("pie\n  \"A\": 1");
  });

  it("supports CRLF line endings", () => {
    const content = "```mermaid\r\nflowchart TD\r\n  A --> B\r\n```\r\n";
    const blocks = extractMermaidBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].code).toBe("flowchart TD\r\n  A --> B");
  });

  it("returns empty for content without fences", () => {
    expect(extractMermaidBlocks("普通文本\n# 标题")).toEqual([]);
  });

  it("drops empty mermaid fences", () => {
    const blocks = extractMermaidBlocks("```mermaid\n\n```");
    expect(blocks).toHaveLength(0);
  });

  it("handles unterminated fence at EOF by discarding it", () => {
    const blocks = extractMermaidBlocks("```mermaid\nflowchart TD");
    expect(blocks).toHaveLength(0);
  });
});

describe("mermaidBlockLabel", () => {
  it("strips the flowchart opener", () => {
    const blocks = extractMermaidBlocks(NOTE);
    expect(mermaidBlockLabel(blocks[0])).toContain("A[开始]");
  });

  it("keeps sequenceDiagram content as the label", () => {
    const blocks = extractMermaidBlocks(NOTE);
    expect(mermaidBlockLabel(blocks[1])).toContain("用户->>服务: 请求");
  });

  it("returns the first line when it has no opener", () => {
    const [block] = extractMermaidBlocks("```mermaid\nA --> B\n```");
    expect(mermaidBlockLabel(block)).toBe("A --> B");
  });

  it("caps very long labels", () => {
    const long = "A".repeat(120);
    const [block] = extractMermaidBlocks(`\`\`\`mermaid\n${long}\n\`\`\``);
    expect(mermaidBlockLabel(block).length).toBeLessThanOrEqual(42);
  });
});
