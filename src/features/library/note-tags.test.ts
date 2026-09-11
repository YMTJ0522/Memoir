import { describe, expect, it } from "vitest";
import { normalizeTags, updateNoteTags } from "./note-tags";

describe("normalizeTags", () => {
  it("trims, strips leading #, drops empties and duplicates", () => {
    expect(normalizeTags(["#work", " work ", "work", "", "ideas"])).toEqual(["work", "ideas"]);
  });

  it("returns an empty list for empty input", () => {
    expect(normalizeTags([])).toEqual([]);
  });
});

describe("updateNoteTags", () => {
  it("inserts a frontmatter block when the note has none", () => {
    expect(updateNoteTags("Hello body", ["work", "ideas"])).toBe(
      '---\ntags: ["work", "ideas"]\n---\n\nHello body',
    );
  });

  it("leaves the note untouched when there is no frontmatter and no tags", () => {
    expect(updateNoteTags("Hello body", [])).toBe("Hello body");
  });

  it("replaces an existing flow-list tags field and keeps other fields", () => {
    const content = '---\ntitle: Hello\ndate: 2020-01-01\ntags: ["old"]\n---\n\nBody\n';
    expect(updateNoteTags(content, ["work"])).toBe(
      '---\ntitle: Hello\ndate: 2020-01-01\ntags: ["work"]\n---\n\nBody\n',
    );
  });

  it("replaces a block-list tags field with its continuation lines", () => {
    const content = "---\ntitle: Hello\ntags:\n  - old\n  - junk\n---\n\nBody\n";
    expect(updateNoteTags(content, ["work"])).toBe(
      '---\ntitle: Hello\ntags: ["work"]\n---\n\nBody\n',
    );
  });

  it("does not rewrite unrelated frontmatter values (dates stay as written)", () => {
    const content = "---\ndate: 2020-01-01\nnested:\n  key: value\n---\n\nBody";
    expect(updateNoteTags(content, ["new"])).toBe(
      "---\ndate: 2020-01-01\nnested:\n  key: value\ntags: [\"new\"]\n---\n\nBody",
    );
  });

  it("appends the tags field when frontmatter exists without one", () => {
    expect(updateNoteTags("---\ntitle: X\n---\n\nBody", ["new"])).toBe(
      '---\ntitle: X\ntags: ["new"]\n---\n\nBody',
    );
  });

  it("removes the whole frontmatter block when tags are cleared and nothing else remains", () => {
    expect(updateNoteTags('---\ntags: ["a"]\n---\n\nBody', [])).toBe("Body\n");
  });

  it("keeps other fields when tags are cleared", () => {
    expect(updateNoteTags('---\ntitle: X\ntags: ["a"]\n---\n\nBody', [])).toBe(
      "---\ntitle: X\n---\n\nBody",
    );
  });

  it("preserves CRLF line endings", () => {
    expect(updateNoteTags("---\r\ntags: [old]\r\n---\r\n\r\nCRLF body", ["win"])).toBe(
      '---\r\ntags: ["win"]\r\n---\r\n\r\nCRLF body',
    );
  });

  it("leaves malformed frontmatter untouched", () => {
    const content = "---\nno closing delimiter\nBody";
    expect(updateNoteTags(content, ["work"])).toBe(content);
  });
});
