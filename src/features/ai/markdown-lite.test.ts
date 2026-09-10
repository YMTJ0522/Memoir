import { describe, expect, it } from "vitest";
import { renderMarkdownLite } from "./markdown-lite";

describe("renderMarkdownLite", () => {
  it("escapes HTML before rendering", () => {
    const html = renderMarkdownLite("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders headings and paragraphs", () => {
    const html = renderMarkdownLite("# Title\n\nBody text");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Body text</p>");
  });

  it("renders fenced code blocks with escaped content", () => {
    const html = renderMarkdownLite("```js\nconst x = \"<b>\";\n```");
    expect(html).toContain("<pre><code>const x = &quot;&lt;b&gt;&quot;;</code></pre>");
    expect(html).not.toMatch(/<pre><code>const x = "<b>";/);
  });

  it("renders inline styles", () => {
    const html = renderMarkdownLite("**bold** *italic* `code` ~~gone~~");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<del>gone</del>");
  });

  it("renders bullet, ordered and task lists", () => {
    const html = renderMarkdownLite("- a\n- b\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
    expect(html).toContain('class="ai-task is-done"');
  });

  it("renders blockquotes and rules", () => {
    const html = renderMarkdownLite("> quoted\n\n---");
    expect(html).toContain("<blockquote>quoted</blockquote>");
    expect(html).toContain("<hr />");
  });

  it("only links http(s) URLs", () => {
    const html = renderMarkdownLite("[safe](https://example.com) [bad](javascript:alert(1))");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("bad");
  });

  it("renders image links as plain text links", () => {
    const html = renderMarkdownLite("![alt](https://example.com/a.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://example.com/a.png"');
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdownLite("")).toBe("");
  });
});
