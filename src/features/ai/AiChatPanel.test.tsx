import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import AiChatPanel from "./AiChatPanel";

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

const configuredAi = {
  ...DEFAULT_SETTINGS,
  ai: {
    enabled: true,
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "test-model",
  },
};

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
    aiSessions: [],
    activeAiSessionId: null,
  });
});

describe("AiChatPanel", () => {
  it("shows the setup card when AI is not configured", () => {
    setGatewaysForTests(createMockGateways());
    const view = render(<AiChatPanel />);
    expect(view.getByRole("heading", { name: "AI 编写" })).toBeInTheDocument();
    expect(view.getByText("AI 编写尚未配置")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "去设置" })).toBeInTheDocument();
  });

  it("opens the AI settings section from the setup card", async () => {
    setGatewaysForTests(createMockGateways());
    const openSettings = vi.fn();
    const original = useAppStore.getState().openSettings;
    useAppStore.setState({ openSettings: openSettings as never });
    const view = render(<AiChatPanel />);
    await userEvent.click(view.getByRole("button", { name: "去设置" }));
    expect(openSettings).toHaveBeenCalledWith("ai");
    useAppStore.setState({ openSettings: original });
  });

  it("sends a message and renders the mocked reply with note context", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["**你好**，我是模拟回复。"];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "# One\n\nOriginal",
    });
    const view = render(<AiChatPanel />);
    const input = view.getByRole("textbox");
    await userEvent.type(input, "帮我总结这篇笔记");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(view.getByText(/我是模拟回复/)).toBeInTheDocument();
    });
    expect(gateways.ai.chatCalls).toHaveLength(1);
    const payload = gateways.ai.chatCalls[0].messages;
    expect(payload[0].role).toBe("system");
    expect(payload[0].content).toContain("AI 写作助手");
    expect(payload[1].role).toBe("system");
    expect(payload[1].content).toContain("当前笔记标题：One");
    expect(payload[1].content).toContain("# One");
    expect(payload.at(-1)).toEqual({ role: "user", content: "帮我总结这篇笔记" });
  });

  it("omits the system note context when the toggle is off", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["回复"];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "# One",
    });
    const view = render(<AiChatPanel />);
    await userEvent.click(view.getByRole("switch", { name: "引用当前笔记" }));
    await userEvent.type(view.getByRole("textbox"), "hi");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(view.getByText("回复")).toBeInTheDocument();
    });
    expect(gateways.ai.chatCalls[0].messages[0].role).toBe("system");
    expect(gateways.ai.chatCalls[0].messages[0].content).toContain("AI 写作助手");
    expect(gateways.ai.chatCalls[0].messages[1].role).toBe("user");
  });

  it("shows an error with retry when the request fails", async () => {
    const gateways = createMockGateways();
    gateways.ai.failChat = true;
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "",
    });
    const view = render(<AiChatPanel />);
    await userEvent.type(view.getByRole("textbox"), "hello");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(view.getByText("请求失败")).toBeInTheDocument();
    });
    expect(view.getByRole("button", { name: "重试" })).toBeInTheDocument();

    // retry succeeds
    gateways.ai.failChat = false;
    gateways.ai.chatResponses = ["恢复成功"];
    await userEvent.click(view.getByRole("button", { name: "重试" }));
    await waitFor(() => {
      expect(view.getByText("恢复成功")).toBeInTheDocument();
    });
  });

  it("inserts an assistant reply into the current note", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["插入的内容"];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "# One",
    });
    const view = render(<AiChatPanel />);
    await userEvent.type(view.getByRole("textbox"), "写一段");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(view.getByText("插入的内容")).toBeInTheDocument();
    });
    await userEvent.click(view.getByRole("button", { name: "插入到当前笔记" }));
    expect(useAppStore.getState().content).toContain("插入的内容");
    expect(useAppStore.getState().libraryPanelMode).toBe("notes");
  });

  it("starts a new chat from the header action", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["回复一"];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "",
    });
    const view = render(<AiChatPanel />);
    await userEvent.type(view.getByRole("textbox"), "q");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(view.getByText("回复一")).toBeInTheDocument();
    });
    await userEvent.click(view.getAllByRole("button", { name: "新对话" })[0]);
    expect(
      view.getByText(
        "向 AI 描述你的写作需求，例如“帮我扩写这一段”或“为这篇笔记写一份摘要”。",
      ),
    ).toBeInTheDocument();
  });

  it("switches the referenced note from the note picker", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("one.md", "# One\n\n正文一");
    gateways.workspace.files.set("two.md", "# Two\n\n正文二");
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One"), note("two.md", "Two")],
      content: "# One\n\n正文一",
    });
    const view = render(<AiChatPanel />);
    // 顶栏出现笔记选择器（当前笔记 One）
    const picker = view.getByRole("combobox", { name: "选择要引用的笔记" });
    expect(picker).toHaveTextContent("One");

    // 切到 Two
    await userEvent.click(picker);
    await userEvent.click(await view.findByRole("option", { name: "Two" }));
    await waitFor(() => {
      expect(useAppStore.getState().activePath).toBe("two.md");
    });
    // AI 面板模式保持不变
    expect(useAppStore.getState().libraryPanelMode).toBe("ai");
    // 选择器显示 Two
    expect(view.getByRole("combobox", { name: "选择要引用的笔记" })).toHaveTextContent("Two");
  });

  it("does not leak the streaming reply into a newly created session", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["流式回复内容"];
    gateways.ai.streamChunkDelayMs = 40; // slow stream so we can switch mid-flight
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "# One",
    });
    const view = render(<AiChatPanel />);
    await userEvent.type(view.getByRole("textbox"), "第一问");
    await userEvent.keyboard("{Enter}");

    // While the reply is still streaming, click "新对话".
    const state = useAppStore.getState();
    const sourceSessionId = state.activeAiSessionId;
    expect(state.aiSessions).toHaveLength(1);
    await waitFor(() => {
      const source = useAppStore
        .getState()
        .aiSessions.find((s) => s.id === sourceSessionId);
      expect(source?.messages.some((m) => m.status === "loading")).toBe(true);
    });
    await userEvent.click(view.getAllByRole("button", { name: "新对话" })[0]);
    const after = useAppStore.getState();
    expect(after.aiSessions).toHaveLength(2);
    expect(after.activeAiSessionId).not.toBe(sourceSessionId);
    expect(after.aiSessions.find((s) => s.id === after.activeAiSessionId)?.messages).toHaveLength(0);

    // Wait for the stream to finish; the new session must still be empty and
    // the reply must have landed in the ORIGINAL session.
    await waitFor(() => {
      expect(gateways.ai.chatCalls).toHaveLength(1);
      const done = useAppStore.getState();
      const source = done.aiSessions.find((s) => s.id === sourceSessionId);
      expect(source?.messages.at(-1)?.content).toBe("流式回复内容");
    });
    const finished = useAppStore.getState();
    const fresh = finished.aiSessions.find((s) => s.id === finished.activeAiSessionId);
    expect(fresh?.messages).toHaveLength(0);
  });

  it("keeps chat history when switching pages and allows switching back", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["回复一"];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "",
    });
    const first = render(<AiChatPanel />);
    await userEvent.type(first.getByRole("textbox"), "第一问");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(first.getByText("回复一")).toBeInTheDocument();
    });

    // switch away (e.g. to notes) and back — the panel unmounts/remounts
    cleanup();
    useAppStore.getState().setLibraryPanelMode("notes");
    useAppStore.getState().setLibraryPanelMode("ai");
    const second = render(<AiChatPanel />);
    await waitFor(() => {
      expect(second.getByText("回复一")).toBeInTheDocument();
    });
    // 会话标题（左侧栏）与用户消息气泡各出现一次
    expect(second.getAllByText("第一问")).toHaveLength(2);
  });

  it("creates a new note from an assistant reply via 另存为新笔记", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["# 标题行\n\n这是内容"];
    setGatewaysForTests(gateways);
    const createNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "",
      createNote: createNote as never,
    });
    const view = render(<AiChatPanel />);
    await userEvent.type(view.getByRole("textbox"), "写一篇");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(view.getByText("标题行")).toBeInTheDocument();
    });
    await userEvent.click(view.getByRole("button", { name: "另存为新笔记" }));
    await waitFor(() => {
      expect(createNote).toHaveBeenCalledWith({
        title: "标题行",
        extension: "md",
      });
    });
  });

  it("shows a collapsible reasoning block for thinking traces", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["最终回答"];
    gateways.ai.streamReasoning = ["第一步思考", "第二步思考"];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "",
    });
    const view = render(<AiChatPanel />);
    await userEvent.type(view.getByRole("textbox"), "分析一下");
    await userEvent.keyboard("{Enter}");

    // 思考块标签出现，思考内容默认收起
    await waitFor(() => {
      expect(view.getByText("思考过程")).toBeInTheDocument();
    });
    expect(view.queryByText("第一步思考")).not.toBeInTheDocument();

    // 展开后能看到完整思考过程（流式逐字拼接，整体呈现）
    await userEvent.click(view.getByRole("button", { name: "思考过程" }));
    expect(view.getByText(/第一步思考/)).toBeInTheDocument();
    expect(view.getByText(/第二步思考/)).toBeInTheDocument();

    // 再次点击收起
    await userEvent.click(view.getByRole("button", { name: "思考过程" }));
    expect(view.queryByText("第一步思考")).not.toBeInTheDocument();
  });

  it("renders quick command chips and sends the preset prompt", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["摘要结果"];
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      activePath: "one.md",
      libraryPanelMode: "ai",
      settings: configuredAi,
      notes: [note("one.md", "One")],
      content: "# One\n\n正文",
    });
    const view = render(<AiChatPanel />);
    const summaryChip = view.getByRole("button", { name: "总结全文" });
    await userEvent.click(summaryChip);
    await waitFor(() => {
      expect(view.getByText("摘要结果")).toBeInTheDocument();
    });
    const lastCall = gateways.ai.chatCalls.at(-1);
    expect(lastCall?.messages.at(-1)?.content).toContain("简洁的中文摘要");
    // 快捷指令附带当前笔记上下文
    expect(lastCall?.messages.some((m) => m.role === "system" && m.content.includes("当前笔记标题：One"))).toBe(true);
  });
});
