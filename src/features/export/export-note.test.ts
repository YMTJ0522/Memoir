import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import { createMockGateways } from "../../test/mock-gateways";
import { useAppStore } from "../../store/app-store";
import { exportNote } from "./export-note";
import { renderNoteDocx } from "./render-note-docx";
import { renderNoteHtmlBody } from "./render-note-html";
import { htmlDocument, markdownDocument, safeFileName, wordDocument } from "./export-document";

vi.mock("./render-note-html", () => ({
  renderNoteHtmlBody: vi.fn().mockResolvedValue("<p>body</p>"),
}));

vi.mock("./render-note-docx", () => ({
  renderNoteDocx: vi.fn().mockResolvedValue(new Uint8Array([80, 75, 3, 4])), // PK\x03\x04
}));

function seedStore() {
  useAppStore.setState({
    workspaceRoot: "/workspace",
    notes: [
      {
        relativePath: "two.mdx",
        fileName: "two.mdx",
        extension: "mdx",
        modifiedMs: 1,
        size: 10,
        title: "two",
        tags: [],
        excerpt: "",
        favorite: false,
      },
    ],
    activePath: "two.mdx",
    loadedContentPath: "two.mdx",
    content: "# two\n\nunsaved",
    savedContent: "# two",
    status: "",
    error: "",
    settings: {
      ...useAppStore.getState().settings,
      appearance: { ...useAppStore.getState().settings.appearance, locale: "zh" },
    },
  });
}

describe("exportNote", () => {
  let gateways: ReturnType<typeof createMockGateways>;

  beforeEach(() => {
    vi.mocked(renderNoteHtmlBody).mockReset();
    vi.mocked(renderNoteHtmlBody).mockResolvedValue("<p>body</p>");
    vi.mocked(renderNoteDocx).mockReset();
    vi.mocked(renderNoteDocx).mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    gateways = createMockGateways();
    gateways.workspace.files.set("two.mdx", "---\ntitle: two\n---\n\n# two\n");
    gateways.workspace.nextExportPath = "/tmp/two.md";
    setGatewaysForTests(gateways);
    seedStore();
  });

  afterEach(() => {
    setGatewaysForTests(null);
  });

  it("exports markdown with a regenerated title front matter", async () => {
    const path = await exportNote("two.mdx", "markdown");
    expect(path).toBe("/tmp/two.md");
    expect(useAppStore.getState().error).toBe("");
    expect(useAppStore.getState().status).toBe("已导出 Markdown");
    expect(gateways.workspace.savedTexts).toHaveLength(1);
    const saved = gateways.workspace.savedTexts[0];
    expect(saved.path).toBe("/tmp/two.md");
    expect(saved.text).toBe('---\ntitle: "two"\n---\n\n# two\n\nunsaved');
    expect(saved.mime).toBe("text/html;charset=utf-8");
  });

  it("exports html through the rendered preview body", async () => {
    const path = await exportNote("two.mdx", "html");
    expect(path).toBe("/tmp/two.md");
    expect(renderNoteHtmlBody).toHaveBeenCalled();
    const saved = gateways.workspace.savedTexts[0];
    expect(saved.text).toContain("<p>body</p>");
    expect(saved.text).toContain("<!DOCTYPE html>");
  });

  it("does nothing when the save dialog is cancelled", async () => {
    const gateways = createMockGateways();
    gateways.workspace.nextExportPath = null;
    setGatewaysForTests(gateways);
    await expect(exportNote("two.mdx", "word")).resolves.toBeNull();
    expect(renderNoteHtmlBody).not.toHaveBeenCalled();
    expect(useAppStore.getState().error).toBe("");
  });

  it("exports word as a true OOXML .docx via the docx library", async () => {
    gateways.workspace.nextExportPath = "/tmp/two.docx";
    const path = await exportNote("two.mdx", "word");
    expect(path).toBe("/tmp/two.docx");
    expect(renderNoteDocx).toHaveBeenCalled();
    expect(useAppStore.getState().status).toBe("已导出 Word");
    // Word export writes binary bytes (PK zip header), not HTML text.
    expect(gateways.workspace.savedExports).toHaveLength(1);
    const saved = gateways.workspace.savedExports[0];
    expect(saved.path).toBe("/tmp/two.docx");
    expect(saved.bytesBase64).toBe("UEsDBA=="); // PK\x03\x04
    expect(gateways.workspace.savedTexts).toHaveLength(0);
  });
});

describe("export-document templates", () => {
  it("sanitizes file names", () => {
    expect(safeFileName('a/b:c*d?"e|f<g>')).toBe("a b c d e f g");
    expect(safeFileName("   ")).toBe("");
  });

  it("regenerates front matter for markdown exports", () => {
    expect(markdownDocument("Two", "body")).toBe('---\ntitle: "Two"\n---\n\nbody');
    expect(markdownDocument("", "body")).toBe("body");
  });

  it("escapes titles in html documents", () => {
    const html = htmlDocument('<script>"x"</script>', "<p>ok</p>", "zh-CN");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>\"x\"</script>");
    expect(html).toContain("<p>ok</p>");
    expect(html).toContain('lang="zh-CN"');
  });

  it("builds word documents with the office namespace", () => {
    const doc = wordDocument("Title", "<p>ok</p>", "zh-CN");
    expect(doc).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
    expect(doc).toContain("<p>ok</p>");
  });

  it("sanitizes preview artifacts for word exports", () => {
    const body = [
      '<details class="memoir-frontmatter-properties"><summary>属性</summary><dl><div class="memoir-frontmatter-row"><dt>title</dt><dd>Two</dd></div></dl></details>',
      '<h1 id="two" data-source-line="2">Two</h1>',
      '<p data-source-line="4">hello</p>',
      '<pre data-source-line="6"><code class="hljs language-Bash"><span class="hljs-built_in">ls</span> -la</code></pre>',
    ].join("");
    const doc = wordDocument("Two", body, "zh-CN");
    // The frontmatter card must be gone.
    expect(doc).not.toContain("memoir-frontmatter");
    expect(doc).not.toContain("<summary>");
    // Scroll-sync attributes must be gone.
    expect(doc).not.toContain("data-source-line");
    // Code highlight spans are unwrapped but the text stays.
    expect(doc).not.toContain("hljs-built_in");
    expect(doc).toContain("ls -la");
    // The duplicated leading h1 is removed (the template emits its own).
    expect(doc.match(/<h1[^>]*>/g)?.length).toBe(1);
    expect(doc).toContain("hello");
  });

  it("strips react node leaks and unwraps list paragraphs for word", () => {
    const body = [
      "<ol>",
      '<li node="[object Object]"><p node="[object Object]">first item</p></li>',
      '<li><p>second item</p></li>',
      "</ol>",
      '<pre node="[object Object]"><code class="hljs language-Bash">a  b\n</code></pre>',
    ].join("");
    const doc = wordDocument("List", body, "zh-CN");
    // ReactMarkdown's internal `node` prop must never leak into the file.
    expect(doc).not.toContain("[object Object]");
    expect(doc).not.toContain('node="');
    // `<li><p>` becomes `<li>` with inline text: one line per list item.
    expect(doc).toContain("<li>first item</li>");
    expect(doc).toContain("<li>second item</li>");
    expect(doc).not.toContain("<li><p>");
  });

  it("inlines callout styles and flattens details for word", () => {
    const body = [
      '<aside class="my-5 rounded-lg border" data-callout="warning"><strong>小心</strong><div>内容</div></aside>',
      '<details><summary>折叠标题</summary><p>折叠内容</p></details>',
    ].join("");
    const doc = wordDocument("Callouts", body, "zh-CN");
    // The warning callout gets an inline left border + background so Word
    // keeps the visual accent (attribute selectors do not work in Word).
    expect(doc).toContain("border-left");
    expect(doc).toContain("rgb(217, 119, 6)"); // #d97706 normalized by the DOM
    expect(doc).toContain("background");
    // Foldable blocks are flattened: the summary becomes a bold paragraph
    // and the details wrapper disappears.
    expect(doc).toContain("font-weight: bold");
    expect(doc).toContain("折叠标题");
    expect(doc).toContain("折叠内容");
    expect(doc).not.toContain("<details");
    expect(doc).not.toContain("<summary");
  });
});
