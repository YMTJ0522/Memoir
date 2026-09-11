import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import MindMapView, { buildMindTree } from "./MindMapView";

// markmap-view drives real d3 + SVG; in jsdom we stub the Markmap class so the
// component can mount and we can assert on our own wiring (double-click,
// context menu, dialogs, setData calls).
const createMarkmap = vi.fn();
const setData = vi.fn().mockResolvedValue(undefined);
const fit = vi.fn().mockResolvedValue(undefined);
const destroy = vi.fn();
const setOptions = vi.fn();
const updateStyle = vi.fn();

vi.mock("markmap-view", () => ({
  Markmap: class {
    static create = createMarkmap;
    setData = setData;
    fit = fit;
    destroy = destroy;
    setOptions = setOptions;
    updateStyle = updateStyle;
  },
}));

function note(relativePath: string, title: string) {
  return {
    relativePath,
    fileName: relativePath,
    extension: "md" as const,
    modifiedMs: 1,
    size: 10,
    title,
    tags: [] as string[],
    excerpt: "",
    favorite: false,
  };
}

function renderWithStore(content: string, activePath = "one.md") {
  useAppStore.setState({
    workspaceRoot: "/workspace",
    notes: [note("one.md", "One"), note("two.md", "Two")],
    activePath,
    content,
    savedContent: content,
    settings: DEFAULT_SETTINGS,
  });
  return render(<MindMapView />);
}

const MARKDOWN = "# 章一\n\n正文……\n\n## 节一\n\n更多正文\n\n## 节二\n\n# 章二\n";

beforeEach(() => {
  createMarkmap.mockClear();
  setData.mockClear();
  fit.mockClear();
  destroy.mockClear();
  setOptions.mockClear();
  updateStyle.mockClear();
  createMarkmap.mockImplementation(() => ({
    setData,
    fit,
    destroy,
    setOptions,
    updateStyle,
  }));
});

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    content: "",
    savedContent: "",
    settings: DEFAULT_SETTINGS,
    libraryPanelMode: "notes",
  });
});

describe("buildMindTree", () => {
  it("builds a nested tree from headings with payload line numbers", () => {
    const tree = buildMindTree([
      { depth: 1, text: "章一", line: 0 },
      { depth: 2, text: "节一", line: 3 },
      { depth: 2, text: "节二", line: 6 },
      { depth: 1, text: "章二", line: 9 },
    ]);
    expect(tree).toEqual({
      content: "",
      children: [
        {
          content: "章一",
          payload: { line: 0, depth: 1 },
          children: [
            { content: "节一", payload: { line: 3, depth: 2 }, children: [] },
            { content: "节二", payload: { line: 6, depth: 2 }, children: [] },
          ],
        },
        { content: "章二", payload: { line: 9, depth: 1 }, children: [] },
      ],
    });
  });

  it("returns an empty root for no headings", () => {
    expect(buildMindTree([])).toEqual({ content: "", children: [] });
  });
});

describe("MindMapView", () => {
  it("renders the stage and feeds the tree into markmap", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(MARKDOWN);
    await waitFor(() => {
      expect(createMarkmap).toHaveBeenCalledTimes(1);
    });
    expect(view.getByRole("heading", { name: "思维导图" })).toBeInTheDocument();
    await waitFor(() => {
      expect(setData).toHaveBeenCalled();
    });
    // The tree is derived from the active note's headings.
    const data = setData.mock.calls[0][0];
    expect(data.children.map((node: { content: string }) => node.content)).toEqual(["章一", "章二"]);
  });

  it("shows the empty state without a note and does not feed markmap", async () => {
    setGatewaysForTests(createMockGateways());
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [note("one.md", "One")],
      activePath: null,
      content: "",
      savedContent: "",
      settings: DEFAULT_SETTINGS,
    });
    const view = render(<MindMapView />);
    expect(view.getByText("先在左侧选择一篇笔记，即可查看它的思维导图。")).toBeInTheDocument();
    // markmap is still created once on mount, but setData never fires with a tree.
    await waitFor(() => {
      expect(createMarkmap).toHaveBeenCalledTimes(1);
    });
    expect(setData).not.toHaveBeenCalled();
  });

  it("double-clicking a node opens the rename dialog and writes back", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(MARKDOWN);
    await waitFor(() => {
      expect(createMarkmap).toHaveBeenCalledTimes(1);
    });
    // Simulate the real DOM: a g.markmap-node element carrying __data__.
    const svg = view.container.querySelector(".mindmap-stage-svg")!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    (g as unknown as { __data__?: unknown }).__data__ = {
      content: "章一",
      payload: { line: 0, depth: 1 },
      children: [],
    };
    svg.appendChild(g);
    g.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        composed: true,
      }),
    );

    const dialog = await view.findByRole("dialog");
    expect(dialog).toHaveTextContent("输入新的节点文字：");
    const input = view.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "第一章");
    await userEvent.click(view.getByRole("button", { name: "重命名" }));

    expect(useAppStore.getState().content).toContain("# 第一章");
    expect(useAppStore.getState().content).not.toContain("# 章一");
  });

  it("opens the node context menu and deletes a heading", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(MARKDOWN);
    await waitFor(() => {
      expect(createMarkmap).toHaveBeenCalledTimes(1);
    });

    const svg = view.container.querySelector(".mindmap-stage-svg")!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    (g as unknown as { __data__?: unknown }).__data__ = {
      content: "节二",
      payload: { line: 8, depth: 2 },
      children: [],
    };
    svg.appendChild(g);
    g.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        composed: true,
        clientX: 100,
        clientY: 100,
      }),
    );

    const menu = await view.findByRole("menu");
    expect(menu).toHaveTextContent("重命名标题");
    expect(menu).toHaveTextContent("向右缩进（层级+1）");
    expect(menu).toHaveTextContent("删除标题");
    await userEvent.click(view.getByRole("menuitem", { name: "删除标题" }));

    const confirm = await view.findByRole("dialog");
    expect(confirm).toHaveTextContent("删除标题「节二」？");
    await userEvent.click(view.getByRole("button", { name: "删除" }));
    expect(useAppStore.getState().content).not.toContain("## 节二");
  });

  it("indent / outdent items edit the heading level", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(MARKDOWN);
    await waitFor(() => {
      expect(createMarkmap).toHaveBeenCalledTimes(1);
    });

    const svg = view.container.querySelector(".mindmap-stage-svg")!;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    (g as unknown as { __data__?: unknown }).__data__ = {
      content: "节一",
      payload: { line: 4, depth: 2 },
      children: [],
    };
    svg.appendChild(g);
    g.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        composed: true,
        clientX: 100,
        clientY: 100,
      }),
    );
    await view.findByRole("menu");
    await userEvent.click(view.getByRole("menuitem", { name: "向右缩进（层级+1）" }));
    expect(useAppStore.getState().content).toContain("### 节一");
  });
});