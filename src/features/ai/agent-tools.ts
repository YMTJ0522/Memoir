/**
 * Agent tools for the AI chat panel.
 *
 * The model receives JSON-schema tool definitions (`AGENT_TOOLS`) and the
 * runner executes matching frontend functions (`runTool`). Tools only read or
 * create notes inside the current workspace — no destructive operations.
 */

import { getGateways } from "../../gateways";

export type AgentToolName =
  | "search_notes"
  | "read_note"
  | "note_outline"
  | "list_tags"
  | "create_note";

export type ToolCallArguments = Record<string, unknown>;

/**
 * Read the freshest note content from the store. Falls back to the gateway
 * when the note is not loaded (the store only keeps the active note's body).
 */
async function noteContent(relativePath: string): Promise<string> {
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  if (state.activePath === relativePath && state.content) {
    return state.content;
  }
  const root = state.workspaceRoot;
  if (!root) return "";
  try {
    const raw = await getGateways().workspace.readNote(root, relativePath);
    return raw;
  } catch {
    return "";
  }
}

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** JSON-schema tool definitions sent to the model. */
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "search_notes",
    description:
      "搜索工作区中的笔记。可按标题、文件名、正文关键词、标签过滤，返回匹配笔记的路径、标题、摘要。当用户询问「某个笔记/资料」时先调用本工具。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "要搜索的关键词（匹配标题、文件名、正文、标签）。",
        },
        limit: {
          type: "integer",
          description: "最多返回多少条结果，默认 8。",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_note",
    description:
      "读取一篇笔记的完整内容。用户提问涉及某篇笔记的具体内容、需要总结或改写某篇笔记时调用。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "笔记的相对路径（来自 search_notes 的结果）。",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "note_outline",
    description:
      "提取一篇笔记的标题大纲（按 Markdown 标题层级）。用户询问笔记结构时调用，比 read_note 更省。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "笔记的相对路径。",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_tags",
    description: "列出工作区里所有笔记标签及其笔记数量。用户询问有哪些标签、按标签找笔记时调用。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_note",
    description: "在工作区创建一篇新笔记。用户要求新建笔记、保存一段内容时调用。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "新笔记标题（会自动生成文件名）。" },
        content: { type: "string", description: "笔记正文（Markdown）。" },
        folder: { type: "string", description: "可选，目标文件夹（相对工作区）。" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "可选，笔记标签列表。",
        },
      },
      required: ["title", "content"],
    },
  },
];

/** Long results are truncated so the conversation stays small. */
const RESULT_SUMMARY_MAX = 12_000;

/** One executed tool call with its result, reported to the caller. */
export type AgentToolStep = {
  tool: string;
  args: string;
  result: string;
  /** Elapsed time for this step in milliseconds. */
  elapsedMs: number;
};

/** Runs one tool call in the frontend; returns a short Markdown string. */
export async function runAgentTool(
  name: string,
  rawArguments: string,
  onStep?: (step: AgentToolStep) => void,
): Promise<string> {
  let parsed: Record<string, unknown>;
  try {
    parsed = (JSON.parse(rawArguments || "{}") ?? {}) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  let summary = "";
  const t0 = performance.now();
  switch (name) {
    case "search_notes": {
      summary = await searchNotes(String(parsed.query ?? ""), Number(parsed.limit) || 8);
      break;
    }
    case "read_note": {
      summary = await readNote(String(parsed.path ?? ""));
      break;
    }
    case "note_outline": {
      summary = await noteOutline(String(parsed.path ?? ""));
      break;
    }
    case "list_tags": {
      summary = await listTags();
      break;
    }
    case "create_note": {
      summary = await createNote(
        String(parsed.title ?? ""),
        String(parsed.content ?? ""),
        parsed.folder != null ? String(parsed.folder) : undefined,
        Array.isArray(parsed.tags) ? parsed.tags.map(String) : undefined,
      );
      break;
    }
    default:
      summary = `未知工具：${name}`;
  }

  const elapsedMs = Math.round(performance.now() - t0);
  onStep?.({
    tool: name,
    args: rawArguments || "{}",
    result: summary,
    elapsedMs,
  });
  return summary;
}

function truncate(text: string, max = RESULT_SUMMARY_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（内容过长，已截断）`;
}

function markdownList(items: Array<{ relativePath: string; title: string; excerpt?: string }>): string {
  if (items.length === 0) return "未找到匹配的笔记。";
  return items
    .map((item) => `- ${item.title}（\`${item.relativePath}\`）${item.excerpt ? `：${item.excerpt}` : ""}`)
    .join("\n");
}

async function searchNotes(query: string, limit: number): Promise<string> {
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const files = state.notes ?? [];
  const q = query.trim().toLowerCase();
  if (!q) {
    return markdownList(files.slice(0, limit).map((note) => ({
      relativePath: note.relativePath,
      title: note.title || note.fileName,
      excerpt: note.excerpt,
    })));
  }
  const matched = files
    .filter((note) => {
      const haystack = [
        note.title,
        note.fileName,
        note.relativePath,
        note.excerpt,
        note.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, limit);
  return markdownList(matched.map((note) => ({
    relativePath: note.relativePath,
    title: note.title || note.fileName,
    excerpt: note.excerpt,
  })));
}

async function readNote(path: string): Promise<string> {
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const note = state.notes?.find((item) => item.relativePath === path);
  if (!note) {
    // Also try a fuzzy match so slight path typos still resolve.
    const fuzzy = state.notes?.find((item) =>
      item.relativePath.toLowerCase().includes(path.toLowerCase()),
    );
    if (!fuzzy) return `未找到笔记：${path}`;
    return readNote(fuzzy.relativePath);
  }
  const content = await noteContent(path);
  const body = parseMarkdownBody(content);
  return `# ${note.title || note.fileName}\n\n${truncate(body)}`;
}

function parseMarkdownBody(content: string): string {
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return stripped.trim();
}

async function noteOutline(path: string): Promise<string> {
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const note = state.notes?.find((item) => item.relativePath === path);
  if (!note) return `未找到笔记：${path}`;
  const content = await noteContent(path);
  const headings = content
    .split("\n")
    .map((line) => line.match(/^(#{1,6})\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => `${"  ".repeat(match[1].length - 1)}- ${match[2].trim()}`);
  if (headings.length === 0) return `「${note.title || note.fileName}」没有标题结构。`;
  return `# ${note.title || note.fileName}\n\n${headings.join("\n")}`;
}

async function listTags(): Promise<string> {
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const counts = new Map<string, number>();
  for (const note of state.notes ?? []) {
    for (const tag of note.tags) {
      const norm = tag.trim().toLowerCase();
      if (!norm) continue;
      counts.set(norm, (counts.get(norm) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (tags.length === 0) return "工作区暂无标签。";
  return tags.map(([tag, count]) => `- ${tag}（${count} 篇）`).join("\n");
}

async function createNote(
  title: string,
  _content: string,
  folder: string | undefined,
  tags: string[] | undefined,
): Promise<string> {
  if (!title.trim()) return "创建笔记失败：缺少标题。";
  const { useAppStore } = await import("../../store/app-store");
  const store = useAppStore.getState();
  try {
    await store.createNote({
      title: title.trim(),
      extension: "md",
      folder,
      tags,
    });
    return `已创建笔记「${title.trim()}」。`;
  } catch (error) {
    return `创建笔记失败：${error instanceof Error ? error.message : String(error)}`;
  }
}