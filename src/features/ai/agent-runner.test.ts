import { afterEach, describe, expect, it, vi } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import type { AiToolCall } from "../../gateways/contracts";
import { createMockGateways } from "../../test/mock-gateways";
import { useAppStore } from "../../store/app-store";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { MAX_AGENT_STEPS, runAgentLoop } from "./agent-runner";

function toolCall(id: string, name: string, args: string): AiToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: args },
  };
}

afterEach(() => {
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

describe("runAgentLoop", () => {
  it("returns the final reply directly when no tool calls are requested", async () => {
    const gateways = createMockGateways();
    gateways.ai.chatResponses = ["最终回复"];
    setGatewaysForTests(gateways);

    const { reply, steps } = await runAgentLoop({
      history: [],
      userMessage: "你好",
      systemPrompt: "你是助手",
    });
    expect(reply.content).toBe("最终回复");
    expect(reply.toolCalls).toEqual([]);
    expect(steps).toEqual([]);
    // Only ONE streaming call happened (no tool rounds).
    expect(gateways.ai.chatCalls).toHaveLength(1);
  });

  it("executes a tool round then returns the final text reply", async () => {
    const gateways = createMockGateways();
    gateways.ai.toolCallResponses = [[toolCall("call_1", "search_notes", '{"query":"预算"}')]];
    gateways.ai.chatResponses = ["中间文本", "基于搜索结果的最终回答"];
    setGatewaysForTests(gateways);

    const { reply, steps } = await runAgentLoop({
      history: [],
      userMessage: "查一下预算相关笔记",
      systemPrompt: "你是助手",
    });
    expect(reply.content).toBe("基于搜索结果的最终回答");
    expect(steps).toHaveLength(1);
    expect(steps[0].tool).toBe("search_notes");
    expect(steps[0].result).toContain("未找到匹配的笔记");

    // Two calls: first round with tool call, second round final text.
    expect(gateways.ai.chatCalls).toHaveLength(2);
    // The second payload must carry the tool message.
    const lastCall = gateways.ai.chatCalls[1];
    const toolMessage = lastCall.messages.find((message) => message.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.toolCallId).toBe("call_1");
    expect(toolMessage?.name).toBe("search_notes");
  });

  it("returns a bounded note when the model loops beyond the cap", async () => {
    const gateways = createMockGateways();
    // The model keeps asking for tools; give enough responses to exhaust the cap.
    gateways.ai.toolCallResponses = Array.from({ length: MAX_AGENT_STEPS }, (_, index) => [
      toolCall(`call_${index}`, "search_notes", "{}"),
    ]);
    setGatewaysForTests(gateways);

    const { reply, steps } = await runAgentLoop({
      history: [],
      userMessage: "循环提问",
      systemPrompt: "你是助手",
    });
    expect(reply.content).toContain("最大工具调用步数");
    expect(steps.length).toBeLessThanOrEqual(MAX_AGENT_STEPS);
  });

  it("executes create_note through the store action", async () => {
    const gateways = createMockGateways();
    gateways.ai.toolCallResponses = [
      [toolCall("call_1", "create_note", JSON.stringify({ title: "测试笔记", content: "内容" }))],
    ];
    gateways.ai.chatResponses = ["已创建", "创建完成"];
    setGatewaysForTests(gateways);

    const createNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ createNote: createNote as never });

    const { steps } = await runAgentLoop({
      history: [],
      userMessage: "帮我建一个笔记",
      systemPrompt: "你是助手",
    });
    expect(createNote).toHaveBeenCalledWith({
      title: "测试笔记",
      extension: "md",
      folder: undefined,
      tags: undefined,
    });
    expect(steps[0].tool).toBe("create_note");
    expect(steps[0].result).toContain("已创建笔记");
  });
});