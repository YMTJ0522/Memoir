import { describe, expect, it } from "vitest";
import { renderNoteDocx } from "./render-note-docx";
import { extractZipEntry } from "./zip-test-utils";
import type { NoteMeta } from "../../domain/notes";

const NOTE: NoteMeta = {
  relativePath: "test.mdx",
  fileName: "test.mdx",
  extension: "mdx",
  modifiedMs: 1,
  size: 10,
  title: "test",
  tags: [],
  excerpt: "",
  favorite: false,
};

describe("renderNoteDocx (real pipeline)", () => {
  it("renders code blocks into the document body", async () => {
    const bytes = await renderNoteDocx({
      root: null,
      relativePath: "test.mdx",
      note: NOTE,
      content: [
        "# Title",
        "",
        "Paragraph text.",
        "",
        "```bash",
        "sudo apt update",
        "sudo apt install curl",
        "```",
        "",
        "Trailing paragraph.",
      ].join("\n"),
      bodyFont: "sans",
      locale: "zh",
    });
    // Valid zip header.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const documentXml = extractZipEntry(bytes, "word/document.xml");
    // Structural sanity.
    expect(documentXml).toContain("<w:document");
    expect(documentXml).toContain("Paragraph text.");
    expect(documentXml).toContain("Trailing paragraph.");
    // The code block content must survive.
    expect(documentXml).toContain("sudo apt update");
    expect(documentXml).toContain("sudo apt install curl");
    // Code runs should use the mono font.
    expect(documentXml).toContain("Consolas");
  });
});
