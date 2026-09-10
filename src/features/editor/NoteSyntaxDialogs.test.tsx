import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WikiCatalogNote } from "./wiki-links";
import { NotePickerDialog, RemoteImageDialog } from "./NoteSyntaxDialogs";

const catalog: WikiCatalogNote[] = [
  { relativePath: "guides/markdown-语法示例.md", title: "Markdown 语法示例" },
  { relativePath: "guides/快捷键.md", title: "快捷键" },
  { relativePath: "journals/2026-09-06.md", title: "2026-09-06" },
];

afterEach(cleanup);

describe("NotePickerDialog", () => {
  it("inserts a wiki token for the picked note", async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <NotePickerDialog
        catalog={catalog}
        embed={false}
        onClose={onClose}
        onInsert={onInsert}
        open
      />,
    );

    await user.click(view.getByRole("option", { name: /快捷键/ }));
    expect(onInsert).toHaveBeenCalledWith("[[快捷键]]");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("prefixes the token for embed mode", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <NotePickerDialog
        catalog={catalog}
        embed
        onClose={() => undefined}
        onInsert={onInsert}
        open
      />,
    );

    await user.click(view.getByRole("option", { name: /Markdown 语法示例/ }));
    expect(onInsert).toHaveBeenCalledWith("![[Markdown 语法示例]]");
  });

  it("filters notes by title and path", async () => {
    const user = userEvent.setup();
    const view = render(
      <NotePickerDialog
        catalog={catalog}
        embed={false}
        onClose={() => undefined}
        onInsert={() => undefined}
        open
      />,
    );

    await user.type(view.getByRole("combobox", { name: "搜索笔记" }), "journal");
    expect(view.queryByRole("option", { name: /快捷键/ })).toBeNull();
    expect(view.getByRole("option", { name: /2026-09-06/ })).toBeInTheDocument();
  });

  it("accepts the active option with Enter from the search field", async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <NotePickerDialog
        catalog={catalog}
        embed={false}
        onClose={() => undefined}
        onInsert={onInsert}
        open
      />,
    );

    const search = view.getByRole("combobox", { name: "搜索笔记" });
    await user.type(search, "{ArrowDown}{ArrowDown}{Enter}");
    expect(onInsert).toHaveBeenCalledWith("[[2026-09-06]]");
  });
});

describe("RemoteImageDialog", () => {
  it("rejects non-http urls and inserts valid ones", async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <RemoteImageDialog onClose={onClose} onInsert={onInsert} open />,
    );

    const input = view.getByRole("textbox", { name: "图片链接" });
    await user.clear(input);
    await user.type(input, "not-a-url");
    expect(view.getByRole("button", { name: "插入" })).toBeDisabled();
    expect(view.getByRole("alert")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "https://example.com/a.png");
    await user.click(view.getByRole("button", { name: "插入" }));
    expect(onInsert).toHaveBeenCalledWith("https://example.com/a.png");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the https prefix and stays quiet before edits", () => {
    const view = render(
      <RemoteImageDialog onClose={() => undefined} onInsert={() => undefined} open />,
    );
    expect(view.queryByRole("alert")).toBeNull();
    expect(
      (view.getByRole("textbox", { name: "图片链接" }) as HTMLInputElement).value,
    ).toBe("https://");
  });
});
