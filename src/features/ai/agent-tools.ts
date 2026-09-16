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
  | "create_note"
  | "web_search"
  | "update_note"
  | "fetch_url"
  | "add_tag"
  | "remove_tag"
  | "list_folders";

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
  {
    name: "web_search",
    description:
      "联网搜索互联网信息。当用户询问实时信息、新闻、技术文档、外部资料，或笔记中没有相关内容时调用。返回搜索结果的标题、链接和摘要。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词。",
        },
        limit: {
          type: "integer",
          description: "最多返回多少条结果，默认 5。",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "update_note",
    description:
      "更新已有笔记的内容。可以替换整篇内容、追加到末尾、或在指定位置插入。用户要求修改、润色、补充某篇笔记时调用。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "笔记的相对路径。" },
        content: { type: "string", description: "新的笔记内容（Markdown）。" },
        mode: {
          type: "string",
          enum: ["replace", "append", "prepend"],
          description: "更新方式：replace 替换整篇，append 追加到末尾，prepend 插入到开头。默认 replace。",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "fetch_url",
    description:
      "抓取网页内容并提取正文。搜索到相关链接后，用此工具读取网页完整内容，再基于内容回答问题。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要抓取的网页 URL。" },
      },
      required: ["url"],
    },
  },
  {
    name: "add_tag",
    description: "给笔记添加标签。用户要求给某篇笔记打标签、分类时调用。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "笔记的相对路径。" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "要添加的标签列表。",
        },
      },
      required: ["path", "tags"],
    },
  },
  {
    name: "remove_tag",
    description: "从笔记移除标签。用户要求删除某篇笔记的标签时调用。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "笔记的相对路径。" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "要移除的标签列表。",
        },
      },
      required: ["path", "tags"],
    },
  },
  {
    name: "list_folders",
    description: "列出工作区中所有文件夹。创建笔记或整理笔记时，先调用此工具了解目录结构。",
    parameters: { type: "object", properties: {} },
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
    case "web_search": {
      summary = await webSearch(String(parsed.query ?? ""), Number(parsed.limit) || 5);
      break;
    }
    case "update_note": {
      summary = await updateNote(
        String(parsed.path ?? ""),
        String(parsed.content ?? ""),
        String(parsed.mode ?? "replace") as "replace" | "append" | "prepend",
      );
      break;
    }
    case "fetch_url": {
      summary = await fetchUrl(String(parsed.url ?? ""));
      break;
    }
    case "add_tag": {
      summary = await addTags(
        String(parsed.path ?? ""),
        Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      );
      break;
    }
    case "remove_tag": {
      summary = await removeTags(
        String(parsed.path ?? ""),
        Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      );
      break;
    }
    case "list_folders": {
      summary = await listFolders();
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

async function webSearch(query: string, limit: number): Promise<string> {
  if (!query.trim()) return "搜索失败：缺少关键词。";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const results = await invoke<Array<{ title: string; url: string; snippet: string }>>(
      "web_search",
      { query: query.trim() },
    );
    if (!results || results.length === 0) return `未找到与「${query}」相关的搜索结果。`;
    const truncated = results.slice(0, limit);
    return truncated
      .map((item, i) => {
        const snippet = item.snippet ? `\n  ${item.snippet}` : "";
        return `${i + 1}. **${item.title}**\n  ${item.url}${snippet}`;
      })
      .join("\n\n");
  } catch (error) {
    return `联网搜索失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function updateNote(
  path: string,
  content: string,
  mode: "replace" | "append" | "prepend",
): Promise<string> {
  if (!path.trim()) return "更新笔记失败：缺少路径。";
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const root = state.workspaceRoot;
  if (!root) return "更新笔记失败：未打开工作区。";

  try {
    let newContent = content;
    if (mode !== "replace") {
      const existing = await noteContent(path);
      if (mode === "append") {
        newContent = `${existing.trimEnd()}\n\n${content.trim()}`;
      } else {
        newContent = `${content.trim()}\n\n${existing.trimStart()}`;
      }
    }
    await getGateways().workspace.writeNote(root, path, newContent);
    // 刷新笔记列表
    await state.refreshWorkspace();
    const action = mode === "replace" ? "更新" : mode === "append" ? "追加内容到" : "插入内容到";
    return `已${action}笔记「${path}」。`;
  } catch (error) {
    return `更新笔记失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function fetchUrl(url: string): Promise<string> {
  if (!url.trim()) return "抓取失败：缺少 URL。";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const html = await invoke<string>("fetch_link_preview_html", { url: url.trim() });
    const text = extractTextFromHtml(html);
    if (!text.trim()) return `已抓取 ${url}，但未能提取到正文内容。`;
    return `# 网页内容：${url}\n\n${truncate(text, 8000)}`;
  } catch (error) {
    return `抓取网页失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

function extractTextFromHtml(html: string): string {
  // 移除 script、style、nav、header、footer 等非正文元素
  let cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  cleaned = cleaned.replace(/<header[\s\S]*?<\/header>/gi, "");
  cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  cleaned = cleaned.replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // 块级元素转换行
  cleaned = cleaned.replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n");
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");

  // 移除所有标签
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 解码 HTML 实体
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));

  // 清理多余空白
  return cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n\n");
}

function parseFrontMatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let rawValue = line.slice(colonIdx + 1).trim();
      // 移除引号
      if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
        rawValue = rawValue.slice(1, -1);
      }
      // 数组
      let value: unknown = rawValue;
      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        value = rawValue
          .slice(1, -1)
          .split(",")
          .map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
      data[key] = value;
    }
  }
  return { data, body: match[2] };
}

function stringifyFrontMatter(data: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => `"${String(v)}"`).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return `${lines.join("\n")}\n\n${body}`;
}

async function addTags(path: string, tags: string[]): Promise<string> {
  if (!path.trim()) return "添加标签失败：缺少路径。";
  if (tags.length === 0) return "添加标签失败：没有指定标签。";
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const root = state.workspaceRoot;
  if (!root) return "添加标签失败：未打开工作区。";

  try {
    const content = await noteContent(path);
    const { data, body } = parseFrontMatter(content);
    const existingTags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
    const newTags = [...new Set([...existingTags, ...tags.map((t) => t.trim())])];
    data.tags = newTags;
    const newContent = stringifyFrontMatter(data, body);
    await getGateways().workspace.writeNote(root, path, newContent);
    await state.refreshWorkspace();
    return `已给笔记「${path}」添加标签：${tags.join(", ")}。当前标签：${newTags.join(", ")}`;
  } catch (error) {
    return `添加标签失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function removeTags(path: string, tags: string[]): Promise<string> {
  if (!path.trim()) return "移除标签失败：缺少路径。";
  if (tags.length === 0) return "移除标签失败：没有指定标签。";
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const root = state.workspaceRoot;
  if (!root) return "移除标签失败：未打开工作区。";

  try {
    const content = await noteContent(path);
    const { data, body } = parseFrontMatter(content);
    const existingTags = Array.isArray(data.tags) ? (data.tags as string[]) : [];
    const removeSet = new Set(tags.map((t) => t.trim()));
    const newTags = existingTags.filter((t) => !removeSet.has(t));
    data.tags = newTags;
    const newContent = stringifyFrontMatter(data, body);
    await getGateways().workspace.writeNote(root, path, newContent);
    await state.refreshWorkspace();
    return `已从笔记「${path}」移除标签：${tags.join(", ")}。当前标签：${newTags.join(", ") || "无"}`;
  } catch (error) {
    return `移除标签失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

async function listFolders(): Promise<string> {
  const { useAppStore } = await import("../../store/app-store");
  const state = useAppStore.getState();
  const notes = state.notes ?? [];
  const folders = new Set<string>();
  for (const note of notes) {
    const parts = note.relativePath.split("/");
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join("/"));
      }
    }
  }
  if (folders.size === 0) return "工作区暂无文件夹，所有笔记都在根目录。";
  return [...folders].sort().map((f) => `- ${f}/`).join("\n");
}