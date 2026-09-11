import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import FlowchartView from "./FlowchartView";

// mermaid-runtime lazily imports real mermaid; in jsdom we stub it so the
// component can mount and we can assert on our own wiring (block extraction,
// diagram switching, zoom/fit buttons, export calls).
const { renderMermaidDiagram } = vi.hoisted(() => ({
  renderMermaidDiagram: vi.fn(),
}));

vi.mock("../preview/mermaid-runtime", () => ({ renderMermaidDiagram }));

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
  return render(<FlowchartView />);
}

const TWO_DIAGRAMS = `# 标题

\`\`\`mermaid
flowchart TD
  A[开始] --> B{判断}
  B -->|是| C[结束]
\`\`\`

中间。

\`\`\`mermaid
sequenceDiagram
  用户->>服务: 请求
  服务-->>用户: 响应
\`\`\`
`;

beforeEach(() => {
  renderMermaidDiagram.mockClear();
  renderMermaidDiagram.mockImplementation(async (code: string) => {
    const key = code.includes("flowchart") ? "flow" : "seq";
    return `<svg class="mock-mermaid" data-key="${key}" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>`;
  });
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

describe("FlowchartView", () => {
  it("renders the flowchart of the active note and feeds mermaid the block", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(TWO_DIAGRAMS);
    expect(view.getByRole("heading", { name: "流程图" })).toBeInTheDocument();
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
    });
    expect(renderMermaidDiagram.mock.calls[0][0]).toContain("flowchart TD");
  const diagram = view.container.querySelector(".flowchart-diagram")!;
  expect(diagram.innerHTML).toContain('data-key="flow"');
  expect(diagram).toBeInTheDocument();
  });

  it("shows the empty state without a note", async () => {
    setGatewaysForTests(createMockGateways());
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [note("one.md", "One")],
      activePath: null,
      content: "",
      savedContent: "",
      settings: DEFAULT_SETTINGS,
    });
    const view = render(<FlowchartView />);
    expect(view.getByText("先在左侧选择一篇笔记，即可查看它的流程图。")).toBeInTheDocument();
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
  });

  it("shows the empty state when the note has no mermaid blocks", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore("# 无图\n普通文本\n```ts\nconst x=1;\n```");
    expect(
      view.getByText("这篇笔记还没有流程图。在正文中添加 ```mermaid 代码块即可生成。"),
    ).toBeInTheDocument();
    expect(renderMermaidDiagram).not.toHaveBeenCalled();
  });

  it("renders the diagram switcher for multiple blocks and switches", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(TWO_DIAGRAMS);
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
    });
    // switcher bar present
    expect(view.getByTestId("flowchart-position")).toHaveTextContent("1 / 2");

    // next diagram
    await userEvent.click(view.getByRole("button", { name: "下一个流程图" }));
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(2);
    });
    expect(renderMermaidDiagram.mock.calls[1][0]).toContain("sequenceDiagram");
    expect(view.getByTestId("flowchart-position")).toHaveTextContent("2 / 2");
    await waitFor(() => {
      expect(
        view.container.querySelector(".flowchart-diagram")!.innerHTML,
      ).toContain('data-key="seq"');
    });

    // back
    await userEvent.click(view.getByRole("button", { name: "上一个流程图" }));
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(3);
    });
    expect(view.getByTestId("flowchart-position")).toHaveTextContent("1 / 2");
  });

  it("re-renders when the note content changes", async () => {
    setGatewaysForTests(createMockGateways());
    renderWithStore(TWO_DIAGRAMS);
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
    });
    // Simulate an edit that changes the first block.
    useAppStore.setState({
      content: "```mermaid\nflowchart LR\n  X --> Y\n```",
    });
    await waitFor(() => {
      expect(renderMermaidDiagram.mock.calls.at(-1)![0]).toContain("X --> Y");
    });
  });

  it("re-fits the viewport when a diagram finishes rendering", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(TWO_DIAGRAMS);
    await waitFor(() => {
      expect(renderMermaidDiagram).toHaveBeenCalledTimes(1);
    });
    // The fit effect runs after the svg is set (double rAF); wait for the
    // canvas transform to be applied.
    await waitFor(() => {
      const canvas = view.container.querySelector(".flowchart-canvas") as HTMLElement | null;
      expect(canvas?.style.transform).toContain("scale");
    });
  });

  it("renders an error state when mermaid fails", async () => {
    setGatewaysForTests(createMockGateways());
    renderMermaidDiagram.mockRejectedValueOnce(new Error("Parse error at line 2"));
    const view = renderWithStore(TWO_DIAGRAMS);
    await waitFor(() => {
      expect(view.getByText(/Parse error/)).toBeInTheDocument();
    });
  });

  it("export buttons call the export gateway", async () => {
    setGatewaysForTests(createMockGateways());
    const view = renderWithStore(TWO_DIAGRAMS);
    await waitFor(() => {
      expect(view.container.querySelector(".flowchart-diagram")).toBeInTheDocument();
    });
    await userEvent.click(view.getByRole("button", { name: "导出 PNG 图片" }));
    expect(renderMermaidDiagram).toHaveBeenCalled();
  });
});