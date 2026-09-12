/**
 * Agent loop runner.
 *
 * Turns a plain chat completion into a tool-using agent: send the request with
 * `AGENT_TOOLS`, and if the model replies with tool calls, execute them through
 * `runAgentTool`, append the `assistant` (with toolCalls) and `tool` messages
 * to the payload, then ask again. The loop ends when the model returns a plain
 * text reply (no tool calls), or after `MAX_AGENT_STEPS` rounds.
 *
 * The runner is UI-agnostic: it reports streaming deltas and executed steps
 * through callbacks so any panel can render progress while the loop runs.
 */

import { getGateways } from "../../gateways";
import type { AiChatMessage, AiToolCall, AiChatReply, AiToolDefinition } from "../../gateways/contracts";
import { AGENT_TOOLS, runAgentTool } from "./agent-tools";

/** Hard cap on tool rounds so a misbehaving model cannot loop forever. */
export const MAX_AGENT_STEPS = 6;

/** Converts the tool definitions to the OpenAI function-tool wire shape. */
function asToolDefinitions(): AiToolDefinition[] {
  return AGENT_TOOLS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** A tool call executed by the frontend during the loop. */
export type AgentRunStep = {
  tool: string;
  args: string;
  result: string;
  /** Elapsed time for this step in milliseconds. */
  elapsedMs: number;
};

/** Callbacks for a running agent loop. */
export type AgentRunCallbacks = {
  /** A streamed content piece of the *final* reply. */
  onDelta?: (piece: string) => void;
  /** A streamed thinking-trace piece (any round). */
  onReasoning?: (piece: string) => void;
  /** Called when a tool call was executed and its result is available. */
  onStep?: (step: AgentRunStep) => void;
};

/**
 * Runs the agent loop against the AI gateway.
 *
 * @param input.history  Chat messages BEFORE this turn (user + assistant),
 *                       without the current user message.
 * @param input.userMessage  The current user prompt.
 * @param input.systemPrompt  System role content.
 * @param input.noteContext   Optional current-note context merged into the
 *                            system prompt.
 * @param input.callbacks     Streaming/tool-step callbacks.
 * @returns The final assistant reply plus the list of executed tool steps.
 */
export async function runAgentLoop(input: {
  history: AiChatMessage[];
  userMessage: string;
  systemPrompt: string;
  noteContext?: string | null;
  callbacks?: AgentRunCallbacks;
}): Promise<{ reply: AiChatReply; steps: AgentRunStep[] }> {
  const { history, userMessage, systemPrompt, noteContext, callbacks } = input;
  const steps: AgentRunStep[] = [];

  const system = noteContext ? `${systemPrompt}\n\n${noteContext}` : systemPrompt;

  // Working payload. Every round uses the STREAMING endpoint because the
  // non-streaming `chatCompletion` only returns plain text and cannot carry
  // tool calls back to the runner. Only the FIRST round forwards deltas to the
  // UI; intermediate tool rounds stream silently (their text is discarded).
  const base: AiChatMessage[] = [
    { role: "system", content: system },
    ...history.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: userMessage },
  ];

  let round = 0;
  while (round < MAX_AGENT_STEPS) {
    const isFirstRound = round === 0;
    const reply = await getGateways().ai.chatCompletionStream(
      { messages: base, tools: asToolDefinitions(), toolChoice: "auto" },
      `agent-${Date.now()}-${round}`,
      isFirstRound ? (piece) => callbacks?.onDelta?.(piece) : () => {},
      isFirstRound ? (piece) => callbacks?.onReasoning?.(piece) : () => {},
    );
    if (reply.toolCalls.length === 0) {
      return { reply, steps };
    }
    // Assistant message carrying the requested tool calls (content may be
    // empty for tool-only turns).
    base.push({
      role: "assistant",
      content: reply.content,
      toolCalls: reply.toolCalls,
    });
    for (const toolCall of reply.toolCalls) {
      await runOneTool(base, toolCall, callbacks, steps);
    }
    round += 1;
  }

  // Ran out of rounds — surface a bounded note so the user is not left hanging.
  return {
    reply: {
      content: "已达本轮最大工具调用步数，仍未能生成最终回答。请换个问法，或把问题拆分后重试。",
      reasoning: "",
      toolCalls: [],
    },
    steps,
  };
}

/** Execute one tool call: run the tool, push the tool message, notify UI. */
async function runOneTool(
  base: AiChatMessage[],
  toolCall: AiToolCall,
  callbacks: AgentRunCallbacks | undefined,
  steps: AgentRunStep[],
): Promise<void> {
  const name = toolCall.function?.name ?? "unknown";
  const args = toolCall.function?.arguments ?? "{}";
  const result = await runAgentTool(name, args, (step) => {
    steps.push(step);
    callbacks?.onStep?.(step);
  });
  base.push({ role: "tool", toolCallId: toolCall.id, name, content: result });
}