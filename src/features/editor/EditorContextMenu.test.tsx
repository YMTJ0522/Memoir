import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorContextMenu } from "./EditorContextMenu";

afterEach(cleanup);

describe("EditorContextMenu", () => {
  it("exposes undo copy and paste actions", async () => {
    const onCopy = vi.fn();
    const onPaste = vi.fn();
    const onUndo = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <EditorContextMenu
        onClose={() => undefined}
        onCopy={onCopy}
        onCut={() => undefined}
        onPaste={onPaste}
        onRedo={() => undefined}
        onSelectAll={() => undefined}
        onUndo={onUndo}
        target={{ x: 12, y: 20, hasSelection: true, canUndo: true, canRedo: false }}
      />,
    );

    expect(view.getByRole("menu", { name: "编辑器操作" })).toBeInTheDocument();
    expect(view.getByRole("menuitem", { name: "撤销" })).not.toHaveFocus();
    expect(view.getByRole("menuitem", { name: "重做" })).toBeDisabled();
    await user.click(view.getByRole("menuitem", { name: "复制" }));
    expect(onCopy).toHaveBeenCalledOnce();
    await user.click(view.getByRole("menuitem", { name: "撤销" }));
    expect(onUndo).toHaveBeenCalledOnce();
    await user.click(view.getByRole("menuitem", { name: "粘贴" }));
    expect(onPaste).toHaveBeenCalledOnce();
  });

  it("disables cut and copy when nothing is selected", () => {
    const view = render(
      <EditorContextMenu
        onClose={() => undefined}
        onCopy={() => undefined}
        onCut={() => undefined}
        onPaste={() => undefined}
        onRedo={() => undefined}
        onSelectAll={() => undefined}
        onUndo={() => undefined}
        target={{ x: 8, y: 8, hasSelection: false, canUndo: false, canRedo: false }}
      />,
    );

    expect(view.getByRole("menuitem", { name: "剪切" })).toBeDisabled();
    expect(view.getByRole("menuitem", { name: "复制" })).toBeDisabled();
    expect(view.getByRole("menuitem", { name: "粘贴" })).toBeEnabled();
  });

  it("runs AI actions on the selection from the context menu", async () => {
    const onAiAction = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <EditorContextMenu
        aiEnabled
        onAiAction={onAiAction}
        onClose={() => undefined}
        onCopy={() => undefined}
        onCut={() => undefined}
        onPaste={() => undefined}
        onRedo={() => undefined}
        onSelectAll={() => undefined}
        onUndo={() => undefined}
        target={{ x: 12, y: 20, hasSelection: true, canUndo: false, canRedo: false }}
      />,
    );

    await user.click(view.getByRole("menuitem", { name: "润色" }));
    expect(onAiAction).toHaveBeenCalledWith("polish");
    await user.click(view.getByRole("menuitem", { name: "扩写" }));
    expect(onAiAction).toHaveBeenCalledWith("expand");
  });

  it("disables AI actions when nothing is selected or AI is busy", () => {
    const view = render(
      <EditorContextMenu
        aiBusy
        aiEnabled
        onAiAction={() => undefined}
        onClose={() => undefined}
        onCopy={() => undefined}
        onCut={() => undefined}
        onPaste={() => undefined}
        onRedo={() => undefined}
        onSelectAll={() => undefined}
        onUndo={() => undefined}
        target={{ x: 8, y: 8, hasSelection: true, canUndo: false, canRedo: false }}
      />,
    );

    expect(view.getByRole("menuitem", { name: "扩写" })).toBeDisabled();
    expect(view.getByRole("menuitem", { name: "翻译" })).toBeDisabled();
  });

  it("hides the AI group when AI is not configured", () => {
    const view = render(
      <EditorContextMenu
        aiEnabled={false}
        onAiAction={() => undefined}
        onClose={() => undefined}
        onCopy={() => undefined}
        onCut={() => undefined}
        onPaste={() => undefined}
        onRedo={() => undefined}
        onSelectAll={() => undefined}
        onUndo={() => undefined}
        target={{ x: 8, y: 8, hasSelection: true, canUndo: false, canRedo: false }}
      />,
    );

    expect(view.queryByRole("menuitem", { name: "扩写" })).not.toBeInTheDocument();
  });
});
