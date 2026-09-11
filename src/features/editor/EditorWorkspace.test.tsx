import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { exportNote } from "../export/export-note";
import { EditorWorkspace } from "./EditorWorkspace";

vi.mock("../export/export-note", () => ({
  exportNote: vi.fn(),
}));

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
  });
});

describe("EditorWorkspace PDF export", () => {
  it("exports the open note from the header button", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
    });
    const user = userEvent.setup();
    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );

    await user.click(view.getByRole("button", { name: "导出" }));
    const pdfItem = view.getByRole("menuitem", { name: "导出 PDF" });
    await user.click(pdfItem);
    expect(exportNote).toHaveBeenCalledWith("alpha.md", "pdf");
  });

  it("invokes header delete and rename without passing the click event", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
    });
    const onDelete = vi.fn();
    const onRename = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <EditorWorkspace isDark={false} onDelete={onDelete} onRename={onRename} />,
    );

    await user.click(view.getByRole("button", { name: "删除" }));
    await user.click(view.getByRole("button", { name: "重命名" }));
    expect(onDelete).toHaveBeenCalledWith();
    expect(onRename).toHaveBeenCalledWith();
  });
});

describe("EditorWorkspace article import", () => {
  it("keeps the import article button out of the markdown toolbar (it lives in the notes header)", () => {
    useAppStore.setState({ workspaceRoot: "/workspace" });
    try {
      const view = render(
        <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
      );

      const toolbar = view.getByRole("toolbar", { name: "Markdown 工具栏" });
      expect(toolbar.textContent).not.toContain("导入文章");
      expect(view.queryByRole("button", { name: "导入文章" })).not.toBeInTheDocument();
    } finally {
      useAppStore.setState({ workspaceRoot: null });
    }
  });
});
