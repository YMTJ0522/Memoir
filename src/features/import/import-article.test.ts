import { describe, expect, it } from "vitest";
import {
  IMPORT_SOURCE_EXTENSIONS,
  convertImportedSource,
  importSourceExtension,
  isImportSourceExtension,
} from "./import-article";

describe("importSourceExtension", () => {
  it("detects supported extensions case-insensitively", () => {
    expect(importSourceExtension("文章.TXT")).toBe("txt");
    expect(importSourceExtension("report.DocX")).toBe("docx");
    expect(importSourceExtension("page.html")).toBe("html");
    expect(importSourceExtension("readme.markdown")).toBe("markdown");
  });

  it("returns null for unsupported or missing extensions", () => {
    expect(importSourceExtension("paper.pdf")).toBeNull();
    expect(importSourceExtension("archive")).toBeNull();
    expect(importSourceExtension("sheet.xlsx")).toBeNull();
  });

  it("treats every listed extension as importable", () => {
    for (const extension of IMPORT_SOURCE_EXTENSIONS) {
      expect(isImportSourceExtension(extension)).toBe(true);
    }
  });
});

describe("convertImportedSource", () => {
  it("keeps markdown sources as-is and titles from the first heading", () => {
    const article = convertImportedSource({
      fileName: "notes.md",
      extension: "md",
      text: "# 计划\n\n## 事项\n\n- one\r\n\r\n\r\n- two\n",
    });
    expect(article.title).toBe("计划");
    expect(article.markdown).toBe("# 计划\n\n## 事项\n\n- one\n\n- two");
  });

  it("escapes markdown specials in txt sources", () => {
    const article = convertImportedSource({
      fileName: "日志.txt",
      extension: "txt",
      text: "# 不是标题\n1. 井号开头的行\n普通行\n",
    });
    expect(article.markdown).toBe("\\# 不是标题\n1\\. 井号开头的行\n普通行");
    expect(article.title).toBe("日志");
  });  it("falls back to the file name when no heading exists", () => {
    const article = convertImportedSource({
      fileName: "随笔.txt",
      extension: "txt",
      text: "只有一段正文。\n",
    });
    expect(article.title).toBe("随笔");
  });

  it("converts html into markdown", () => {
    const article = convertImportedSource({
      fileName: "export.htm",
      extension: "htm",
      text: [
        "<!DOCTYPE html>",
        "<html><head><style>body{color:red}</style></head>",
        "<body><h1>会议纪要</h1><p>今天讨论了<b>导入</b>功能。</p>",
        "<ul><li>方案一</li><li>方案二</li></ul></body></html>",
      ].join("\n"),
    });
    expect(article.title).toBe("会议纪要");
    expect(article.markdown).toContain("# 会议纪要");
    expect(article.markdown).toContain("**导入**");
    expect(article.markdown).toContain("- 方案一");
    expect(article.markdown).not.toContain("<");
    expect(article.markdown).not.toContain("color:red");
  });

  it("converts docx html output into markdown", () => {
    const article = convertImportedSource({
      fileName: "合同.docx",
      extension: "docx",
      text: '<h1>服务条款</h1><p><strong>甲方</strong>与乙方达成一致。</p><p><a href="https://example.com">参考链接</a></p>',
    });
    expect(article.title).toBe("服务条款");
    expect(article.markdown).toContain("**甲方**");
    expect(article.markdown).toContain("[参考链接](https://example.com)");
  });

  it("normalizes line endings and collapses extra blank lines", () => {
    const article = convertImportedSource({
      fileName: "draft.md",
      extension: "md",
      text: "a\r\n\r\n\r\nb  \r\nc\n",
    });
    expect(article.markdown).toBe("a\n\nb\nc");
  });
});
