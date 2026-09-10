import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { AttachmentLibrary } from "./AttachmentLibrary";

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    activePath: null,
    attachments: [],
    error: "",
  });
});

describe("AttachmentLibrary", () => {
  it("inserts a note-relative markdown image on click", async () => {
    const onInsert = vi.fn();
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: "日记/today.md",
      attachments: [
        {
          relativePath: "attachments/paste-1.png",
          fileName: "paste-1.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: Date.now(),
          size: 2048,
        },
      ],
    });
    const user = userEvent.setup();
    const view = render(<AttachmentLibrary onInsert={onInsert} />);

    expect(view.getByText("paste-1.png")).toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "paste-1.png" }));
    expect(onInsert).toHaveBeenCalledWith("![paste-1](../attachments/paste-1.png)");
  });

  it("asks for an open note before inserting", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: null,
      attachments: [
        {
          relativePath: "attachments/paste-1.png",
          fileName: "paste-1.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: 1,
          size: 12,
        },
      ],
    });
    const user = userEvent.setup();
    const view = render(<AttachmentLibrary onInsert={vi.fn()} />);
    await user.click(view.getByRole("button", { name: "paste-1.png" }));
    expect(useAppStore.getState().error).toContain("笔记");
  });

  it("opens a delete confirmation from the context menu", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: "welcome.md",
      attachments: [
        {
          relativePath: "attachments/paste-1.png",
          fileName: "paste-1.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: 1,
          size: 12,
        },
      ],
    });
    const view = render(<AttachmentLibrary />);
    fireEvent.contextMenu(view.getByRole("button", { name: "paste-1.png" }), {
      clientX: 24,
      clientY: 48,
    });
    expect(view.getByRole("menu", { name: "paste-1.png 的操作" })).toBeInTheDocument();
  });

  it("selects multiple attachments and batch-deletes them after confirmation", async () => {
    const deleteAttachments = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: "welcome.md",
      attachments: [
        {
          relativePath: "attachments/a.png",
          fileName: "a.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: 1,
          size: 12,
        },
        {
          relativePath: "attachments/b.mp4",
          fileName: "b.mp4",
          extension: "mp4",
          mimeType: "video/mp4",
          modifiedMs: 1,
          size: 12,
        },
        {
          relativePath: "attachments/c.png",
          fileName: "c.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: 1,
          size: 12,
        },
      ],
      deleteAttachments,
    });
    const user = userEvent.setup();
    const view = render(<AttachmentLibrary />);

    await user.click(view.getByRole("button", { name: "选择" }));
    expect(view.getByText("已选 0 项")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "a.png" }));
    await user.click(view.getByRole("button", { name: "b.mp4" }));
    expect(view.getByText("已选 2 项")).toBeInTheDocument();
    expect(view.getByText("删除所选（2）")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "全选" }));
    expect(view.getByText("已选 3 项")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: /删除所选/ }));
    const dialog = await view.findByRole("dialog");
    expect(dialog).toHaveTextContent("确认删除所选的 3 个附件？");
    await user.click(view.getByRole("button", { name: "移入回收站" }));
    expect(deleteAttachments).toHaveBeenCalledTimes(1);
    expect(deleteAttachments).toHaveBeenCalledWith(
      expect.arrayContaining([
        "attachments/a.png",
        "attachments/b.mp4",
        "attachments/c.png",
      ]),
    );
  });

  it("renders a video icon instead of a broken image for video attachments", () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: "welcome.md",
      attachments: [
        {
          relativePath: "attachments/demo.mp4",
          fileName: "demo.mp4",
          extension: "mp4",
          mimeType: "video/mp4",
          modifiedMs: 1,
          size: 123456,
        },
      ],
    });
    const view = render(<AttachmentLibrary />);
    expect(view.container.querySelector("video")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.getByText("demo.mp4")).toBeInTheDocument();
  });
});
