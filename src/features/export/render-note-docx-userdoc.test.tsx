import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderNoteDocx } from "./render-note-docx";
import type { NoteMeta } from "../../domain/notes";
import { extractZipEntry } from "./zip-test-utils";

// The user's real export document — 124 fenced code blocks.
const USER_DOC = "C:/Users/ymtj1/Desktop/Linux 从入门到实战完整教程.md";

const NOTE: NoteMeta = {
  relativePath: "linux.md",
  fileName: "linux.md",
  extension: "md",
  modifiedMs: 1,
  size: 10,
  title: "linux",
  tags: [],
  excerpt: "",
  favorite: false,
};

describe("renderNoteDocx (user doc)", () => {
  it("keeps every fenced code block", async () => {
    const content = readFileSync(USER_DOC, "utf8");
    const bytes = await renderNoteDocx({
      root: null,
      relativePath: "linux.md",
      note: NOTE,
      content,
      bodyFont: "sans",
      locale: "zh",
    });
    const documentXml = extractZipEntry(bytes, "word/document.xml");
    // Count code lines in the source vs. code runs in the docx.
    const codeLines = content
      .split(/^```.*$/m)
      .filter((_, index) => index % 2 === 1)
      .map((block) => block.replace(/\n$/, "").split("\n").filter((line) => line.trim() !== "").length)
      .reduce((sum, count) => sum + count, 0);
    // Real snippets from the user's document (verified to exist verbatim).
    const samples = [
      "ssh root@192.168.1.100",
      "cat /etc/os-release",
      "ls -l /home",
      "tar -cvf archive.tar",
    ];
    for (const sample of samples) {
      expect(documentXml, `missing snippet: ${sample}`).toContain(sample);
    }
    // The mono font must be used (code runs) — count occurrences.
    const consolasCount = (documentXml.match(/Consolas/g) ?? []).length;
    expect(consolasCount, "code runs with Consolas font").toBeGreaterThanOrEqual(codeLines);
    // Light code-block styling must be present: light gray shading + dark text.
    expect(documentXml).toContain('w:fill="F5F5F5"');
    expect(documentXml).toContain('w:val="1F2937"');
  });
});
