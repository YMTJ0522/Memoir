import { describe, expect, it } from "vitest";
import {
  INLINE_MARKS,
  insertBlockIdCommand,
  insertCalloutCommand,
  insertCodeBlockCommand,
  insertFootnoteCommand,
  insertFrontMatterCommand,
  insertImageCommand,
  insertLineBlockCommand,
  insertLinkCommand,
  insertTabsCommand,
  insertTagCommand,
  insertTextCommand,
  insertWrappedBlockCommand,
  toggleBlockPrefix,
  toggleHeadingLevel,
  toggleInlineCodeSpan,
  toggleInlineFormat,
  toggleWrap,
  type MarkdownCommandResult,
} from "./markdown-commands";

/** Applies a command's ChangeSpec(s) to the doc (positions, CM semantics). */
function apply(doc: string, result: MarkdownCommandResult): { doc: string; selection: MarkdownCommandResult["selection"] } {
  const changes = (Array.isArray(result.change) ? result.change : [result.change]).filter(
    (change): change is { from: number; to?: number; insert?: string } => change !== "" && change != null,
  ) as Array<{ from: number; to?: number; insert?: string }>;
  // Apply back-to-front; same-position inserts apply later-array-index first
  // so the final document keeps the array order (CodeMirror semantics).
  const indexed = changes.map((change, index) => ({ change, index }));
  indexed.sort((a, b) => b.change.from - a.change.from || b.index - a.index);
  let output = doc;
  for (const { change } of indexed) {
    const to = change.to ?? change.from;
    output = output.slice(0, change.from) + (change.insert ?? "") + output.slice(to);
  }
  return { doc: output, selection: result.selection };
}

const cursor = (at: number) => ({ from: at, to: at });
const range = (from: number, to: number) => ({ from, to });

describe("INLINE_MARKS", () => {
  it("matches the inkstone toolbar marks", () => {
    expect(INLINE_MARKS).toEqual({
      bold: "**",
      italic: "*",
      strikethrough: "~~",
      code: "`",
      highlight: "==",
      inlineMath: "$",
    });
  });
});

describe("toggleWrap", () => {
  it("wraps selected text and selects the inner text", () => {
    const result = toggleWrap("hello world", range(6, 11), "**");
    const applied = apply("hello world", result);
    expect(applied.doc).toBe("hello **world**");
    expect(applied.selection).toEqual({ anchor: 8, head: 13 });
  });

  it("removes surrounding marks and keeps the selection", () => {
    const doc = "hello **world**";
    const result = toggleWrap(doc, range(8, 13), "**");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("hello world");
    // inkstone maps the selection to from - open.length (pre-change coords).
    expect(applied.selection).toEqual({ anchor: 6, head: 11 });
  });

  it("unwraps marks contained in the selection", () => {
    const doc = "hello **world**";
    const result = toggleWrap(doc, range(6, 15), "**");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("hello world");
    expect(applied.selection).toEqual({ anchor: 6, head: 11 });
  });

  it("italic peels one asterisk from ***text*** (parity)", () => {
    const doc = "***word***";
    const result = toggleWrap(doc, range(3, 7), "*");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("**word**");
  });

  it("italic uses a single asterisk when wrapping", () => {
    const doc = "hello world";
    const result = toggleWrap(doc, range(6, 11), "*");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("hello *world*");
  });

  it("supports different open/close pairs ([[ ]])", () => {
    const doc = "hello";
    const result = toggleWrap(doc, range(0, 5), "[[", "]]");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("[[hello]]");
  });

  it("inserts an empty pair for an empty selection without a word", () => {
    const result = toggleWrap("  ", cursor(1), "**");
    const applied = apply("  ", result);
    expect(applied.doc).toBe(" **** ");
  });
});

describe("toggleInlineFormat", () => {
  it("wraps selected text with bold marks", () => {
    const result = toggleInlineFormat("hello world", range(6, 11), "bold");
    const applied = apply("hello world", result);
    expect(applied.doc).toBe("hello **world**");
    expect(applied.selection).toEqual({ anchor: 8, head: 13 });
  });

  it("unwraps when the selection is already wrapped", () => {
    const doc = "hello **world**";
    const result = toggleInlineFormat(doc, range(8, 13), "bold");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("hello world");
    // Marks removed: inkstone maps to from - open.length (pre-change coords).
    expect(applied.selection).toEqual({ anchor: 6, head: 11 });
  });

  it("expands an empty cursor selection to the word", () => {
    const result = toggleInlineFormat("hello world", cursor(8), "italic");
    const applied = apply("hello world", result);
    expect(applied.doc).toBe("hello *world*");
    expect(applied.selection).toEqual({ anchor: 7, head: 12 });
  });

  it("expands CJK words between punctuation", () => {
    const result = toggleInlineFormat("你好，世界。", cursor(3), "bold");
    const applied = apply("你好，世界。", result);
    expect(applied.doc).toBe("你好，**世界**。");
  });

  it("toggles highlight marks", () => {
    const doc = "==重要==";
    const result = toggleInlineFormat(doc, range(2, 4), "highlight");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("重要");
  });
});

describe("toggleInlineCodeSpan", () => {
  it("wraps the selection in single backticks", () => {
    const doc = "run speed test";
    const result = toggleInlineCodeSpan(doc, range(4, 9));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("run `speed` test");
    expect(applied.selection).toEqual({ anchor: 5, head: 10 });
  });

  it("unwraps a contained span and strips padding spaces", () => {
    const doc = "run ` speed ` test";
    const result = toggleInlineCodeSpan(doc, range(4, 13));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("run speed test");
    expect(applied.selection).toEqual({ anchor: 4, head: 9 });
  });

  it("removes surrounding equal backtick runs", () => {
    const doc = "run `speed` test";
    const result = toggleInlineCodeSpan(doc, range(5, 10));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("run speed test");
    expect(applied.selection).toEqual({ anchor: 4, head: 9 });
  });

  it("wraps plain text without padding", () => {
    const doc = "a b";
    const result = toggleInlineCodeSpan(doc, range(0, 3));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("`a b`");
  });

  it("grows the fence when the text contains backticks", () => {
    const doc = "has ` inside";
    const result = toggleInlineCodeSpan(doc, range(0, 12));
    const applied = apply(doc, result);
    // No padding: neither end touches whitespace or a backtick.
    expect(applied.doc).toBe("``has ` inside``");
  });

  it("expands an empty selection to the word under the cursor", () => {
    const doc = "run speed";
    const result = toggleInlineCodeSpan(doc, cursor(7));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("run `speed`");
  });

  it("inserts an empty pair when there is no word", () => {
    const doc = "  ";
    const result = toggleInlineCodeSpan(doc, cursor(1));
    const applied = apply(doc, result);
    expect(applied.doc).toBe(" `` ");
    expect(applied.selection).toEqual({ anchor: 2 });
  });
});

describe("toggleBlockPrefix", () => {
  it("adds bullet prefixes to every selected line", () => {
    const doc = "alpha\nbeta";
    const result = toggleBlockPrefix(doc, range(0, doc.length), "bullet");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("- alpha\n- beta");
  });

  it("removes bullet prefixes when every line is already a bullet", () => {
    const doc = "- alpha\n- beta";
    const result = toggleBlockPrefix(doc, range(0, doc.length), "bullet");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("alpha\nbeta");
  });

  it("keeps lines without the prefix when mixed (bullet)", () => {
    const doc = "- alpha\nplain";
    const result = toggleBlockPrefix(doc, range(0, doc.length), "bullet");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("- alpha\n- plain");
  });

  it("replaces other list-ish prefixes when adding tasks", () => {
    const doc = "- alpha\n  1. beta";
    const result = toggleBlockPrefix(doc, range(0, doc.length), "task");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("- [ ] alpha\n  - [ ] beta");
  });

  it("converts bullets to tasks preserving indentation", () => {
    const doc = "- alpha\n  - beta";
    const result = toggleBlockPrefix(doc, range(0, doc.length), "task");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("- [ ] alpha\n  - [ ] beta");
  });

  it("converts quotes to ordered lists, appending the number (no quote replacement)", () => {
    const doc = "> alpha\n> beta\n> gamma";
    const result = toggleBlockPrefix(doc, range(0, doc.length), "ordered");
    const applied = apply(doc, result);
    // inkstone's toggleOrderedList has no replacementPattern, so the quote
    // prefix is not replaced — the number is simply prepended.
    expect(applied.doc).toBe("1. > alpha\n2. > beta\n3. > gamma");
  });

  it("covers the full line of the selection ends", () => {
    const doc = "one\ntwo\nthree";
    const result = toggleBlockPrefix(doc, range(4, 5), "quote");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("one\n> two\nthree");
  });

  it("contracts the selection when it ends at a line start", () => {
    const doc = "one\ntwo\nthree";
    // Range covers "one\ntwo\n" — the trailing line start is excluded.
    const result = toggleBlockPrefix(doc, range(0, 8), "quote");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("> one\n> two\nthree");
  });

  it("maps the selection through the applied changes", () => {
    const doc = "alpha\nbeta";
    const result = toggleBlockPrefix(doc, range(0, doc.length), "bullet");
    const applied = apply(doc, result);
    // inkstone maps the original selection through the change set (assoc +1).
    expect(applied.selection).toEqual({ anchor: 2, head: 14 });
  });
});

describe("toggleHeadingLevel", () => {
  it("adds a heading level to plain lines", () => {
    const result = toggleHeadingLevel("Title", range(0, 5), 2);
    const applied = apply("Title", result);
    expect(applied.doc).toBe("## Title");
  });

  it("replaces an existing level", () => {
    const doc = "## Title";
    const result = toggleHeadingLevel(doc, range(0, 8), 3);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("### Title");
  });

  it("clears the heading when the level matches", () => {
    const doc = "### Title";
    const result = toggleHeadingLevel(doc, range(0, 9), 3);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("Title");
  });

  it("applies to every selected line", () => {
    const doc = "one\ntwo";
    const result = toggleHeadingLevel(doc, range(0, doc.length), 1);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("# one\n# two");
  });

  it("maps the cursor through the change", () => {
    const doc = "Title";
    const result = toggleHeadingLevel(doc, range(0, 5), 2);
    const applied = apply(doc, result);
    expect(applied.selection).toEqual({ anchor: 3, head: 8 });
  });
});

describe("insertLinkCommand", () => {
  it("wraps selected text as label and puts the cursor before )", () => {
    const doc = "see this page";
    const result = insertLinkCommand(doc, range(4, 8), "https://x.dev");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("see [this](<https://x.dev>) page");
    expect(applied.selection).toEqual({ anchor: 26 });
  });

  it("uses a bare destination when no url is given", () => {
    const doc = "text";
    const result = insertLinkCommand(doc, range(0, 4));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("[text]()");
    expect(applied.selection).toEqual({ anchor: 7 });
  });

  it("escapes brackets in the label", () => {
    const doc = "a [b] c";
    const result = insertLinkCommand(doc, range(0, doc.length));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("[a \\[b\\] c]()");
  });
});

describe("insertImageCommand", () => {
  it("wraps selected text as alt and puts the cursor before )", () => {
    const doc = "logo here";
    const result = insertImageCommand(doc, range(0, 4), "img.png");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("![logo](<img.png>) here");
    expect(applied.selection).toEqual({ anchor: 17 });
  });

  it("places the cursor inside the alt when empty", () => {
    const doc = "";
    const result = insertImageCommand(doc, cursor(0));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("![]()");
    expect(applied.selection).toEqual({ anchor: 2 });
  });
});

describe("insertTextCommand", () => {
  it("replaces the selection and lands the cursor at the offset", () => {
    const doc = "ab";
    const result = insertTextCommand(range(0, 2), "$$\n\n$$\n", 3);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("$$\n\n$$\n");
    expect(applied.selection).toEqual({ anchor: 3 });
  });
});

describe("insertTagCommand", () => {
  it("inserts # before a cursor selection", () => {
    const result = insertTagCommand(cursor(3));
    expect(result.change).toEqual({ from: 3, insert: "#" });
    expect(result.selection).toEqual({ anchor: 4 });
  });

  it("shifts a non-empty selection right by one", () => {
    const result = insertTagCommand(range(2, 5));
    expect(result.selection).toEqual({ anchor: 3, head: 6 });
  });
});

describe("insertBlockIdCommand", () => {
  it("adds a separating space after non-whitespace", () => {
    const doc = "text";
    const result = insertBlockIdCommand(doc, cursor(4));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("text ^");
    expect(applied.selection).toEqual({ anchor: 6 });
  });

  it("skips the space after whitespace or at start", () => {
    const doc = "text ";
    const result = insertBlockIdCommand(doc, cursor(5));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("text ^");
    expect(applied.selection).toEqual({ anchor: 6 });
  });
});

describe("insertFootnoteCommand", () => {
  it("numbers the first footnote as 1 and appends the definition", () => {
    const doc = "body text";
    const result = insertFootnoteCommand(doc, cursor(9));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("body text[^1]\n\n[^1]: ");
    expect(applied.selection).toEqual({ anchor: applied.doc.length });
  });

  it("picks the next free number", () => {
    const doc = "a[^1] b[^3]";
    const result = insertFootnoteCommand(doc, cursor(doc.length));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("a[^1] b[^3][^2]\n\n[^2]: ");
  });

  it("reuses a single newline when the doc ends with one", () => {
    const doc = "line\n";
    const result = insertFootnoteCommand(doc, cursor(doc.length));
    const applied = apply(doc, result);
    // Separator is a single \n; CM maps the second insert (same position)
    // after the reference, so the definition follows it directly.
    expect(applied.doc).toBe("line\n[^1]\n[^1]: ");
  });
});

describe("insertCalloutCommand", () => {
  it("inserts an empty NOTE callout", () => {
    const doc = "";
    const result = insertCalloutCommand(doc, cursor(0));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("> [!NOTE]\n> ");
  });

  it("quotes every selected line", () => {
    const doc = "one\ntwo";
    const result = insertCalloutCommand(doc, range(0, doc.length));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("> [!NOTE]\n> one\n> two");
  });
});

describe("insertWrappedBlockCommand", () => {
  it("uses the fallback content and lands the cursor at the offset", () => {
    const doc = "";
    const result = insertWrappedBlockCommand(doc, cursor(0), "```mermaid", "```", "flowchart LR\n  A --> B", 16);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("```mermaid\nflowchart LR\n  A --> B\n```\n");
    expect(applied.selection).toEqual({ anchor: 16 });
  });

  it("keeps selected text as the content", () => {
    const doc = "graph TD";
    const result = insertWrappedBlockCommand(doc, range(0, 8), "```mermaid", "```", "fallback");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("```mermaid\ngraph TD\n```\n");
    expect(applied.selection).toEqual({ anchor: 19 });
  });
});

describe("insertTabsCommand", () => {
  it("selects the first tab label for immediate rename", () => {
    const doc = "";
    const result = insertTabsCommand(doc, cursor(0), "标签一", "标签二");
    const applied = apply(doc, result);
    expect(applied.doc).toBe(
      ":::: tabs\n::: tab-item 标签一\n\n:::\n::: tab-item 标签二\n\n:::\n::::\n",
    );
    expect(applied.selection).toEqual({ anchor: 23, head: 26 });
  });

  it("keeps selected text as the first tab body", () => {
    const doc = "body";
    const result = insertTabsCommand(doc, range(0, 4), "A", "B");
    const applied = apply(doc, result);
    expect(applied.doc).toBe(":::: tabs\n::: tab-item A\nbody\n\n:::\n::: tab-item B\n\n:::\n::::\n");
    expect(applied.selection).toEqual({ anchor: 29 });
  });
});

describe("insertCodeBlockCommand", () => {
  it("inserts an empty fence and lands on the body line", () => {
    const doc = "";
    const result = insertCodeBlockCommand(doc, cursor(0));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("```\n\n```\n");
    expect(applied.selection).toEqual({ anchor: 3 });
  });

  it("keeps the selection when an info string is given", () => {
    const doc = "code";
    const result = insertCodeBlockCommand(doc, range(0, 4), "text title=\"x\"");
    const applied = apply(doc, result);
    expect(applied.doc).toBe("```text title=\"x\"\ncode\n```\n");
    expect(applied.selection).toEqual({ anchor: 18, head: 22 });
  });

  it("grows the fence around selections containing backticks", () => {
    const doc = "```\ncode\n```";
    const result = insertCodeBlockCommand(doc, range(0, doc.length));
    const applied = apply(doc, result);
    expect(applied.doc).toBe("````\n```\ncode\n```\n````\n");
  });
});

describe("insertLineBlockCommand", () => {
  it("appends a table after a non-empty line", () => {
    const doc = "标题";
    const result = insertLineBlockCommand(doc, cursor(2), "| a | b |\n| --- | --- |\n|  |  |", 2);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("标题\n| a | b |\n| --- | --- |\n|  |  |");
    expect(applied.selection).toEqual({ anchor: 5 });
  });

  it("appends at the line end without a break on an empty line", () => {
    const doc = "";
    const result = insertLineBlockCommand(doc, cursor(0), "---\n\n", 5);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("---\n\n");
    expect(applied.selection).toEqual({ anchor: 5 });
  });

  it("preserves the head when the selection is reversed", () => {
    const doc = "hello";
    const result = insertLineBlockCommand(doc, { from: 3, to: 2, head: 2 }, "---\n\n", 5);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("hello\n---\n\n");
    expect(applied.selection).toEqual({ anchor: 11 });
  });
});

describe("insertFrontMatterCommand", () => {
  it("inserts the default header and puts the cursor after title:", () => {
    const doc = "body";
    const result = insertFrontMatterCommand(doc);
    const applied = apply(doc, result);
    expect(applied.doc).toBe("---\ntitle: \ntags: []\n---\n\nbody");
    expect(applied.selection).toEqual({ anchor: 11 });
  });

  it("jumps below an existing front matter instead", () => {
    const doc = "---\ntitle: x\n---\nbody";
    const result = insertFrontMatterCommand(doc);
    expect(result.change).toEqual([]);
    // Cursor to the end of the first `---` line.
    expect(result.selection).toEqual({ anchor: 4 });
  });
});

