import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  Heading1,
  Languages,
  ListTree,
  MessageSquarePlus,
  RotateCcw,
  Sparkles,
  Tags,
  Trash2,
  TriangleAlert,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import type { MessageKey } from "../../i18n/translate";
import { isAiConfigured } from "../../domain/settings";
import { isTauriRuntime } from "../../platform/runtime";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { useAppStore } from "../../store/app-store";
import type { AiChatMessage, AiSession } from "../../store/types";
import { renderMarkdownLite } from "./markdown-lite";
import { Button, IconButton, Select, Toggle } from "../../components/ui";

const MAX_NOTE_CONTEXT_CHARS = 30_000;
const SYSTEM_ROLE = `你是用户的 AI 写作助手。请始终使用简体中文回复，语气自然专业。
不要自称"豆包""DeepSeek""Kimi"或其他任何模型/厂商名称，直接以助手身份回答问题即可。`;

const NEW_SESSION_VALUE = "__new__";

type ChatMessage = AiChatMessage;

function buildNoteContext(title: string, content: string) {
  const trimmed =
    content.length > MAX_NOTE_CONTEXT_CHARS
      ? `${content.slice(0, MAX_NOTE_CONTEXT_CHARS)}\n…（内容过长，已截断）`
      : content;
  return `当前笔记标题：${title}\n\n当前笔记全文：\n${trimmed}`;
}

let nextMessageId = 0;

function sessionTitleFromFirstUserMessage(content: string) {
  const firstLine = content.trim().split("\n")[0];
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine;
}

type QuickCommandIcon =
  | "summary"
  | "outline"
  | "title"
  | "translate"
  | "tags"
  | "polish";

/** Pre-built quick commands shown in the empty state. */
const QUICK_COMMANDS: Array<{
  key: MessageKey;
  icon: QuickCommandIcon;
  prompt: string;
}> = [
  { key: "ai.quickSummary", icon: "summary", prompt: "请为当前笔记写一份简洁的中文摘要，分条列出要点。" },
  { key: "ai.quickOutline", icon: "outline", prompt: "请为当前笔记生成一份清晰的中文大纲（Markdown 标题层级）。" },
  { key: "ai.quickTitle", icon: "title", prompt: "请为当前笔记拟 3 个简洁贴切的中文标题，每个一行。" },
  { key: "ai.quickTranslate", icon: "translate", prompt: "请将当前笔记翻译成英文，保留 Markdown 格式。" },
  { key: "ai.quickTags", icon: "tags", prompt: "请为当前笔记推荐 3-5 个标签，逗号分隔。" },
  { key: "ai.quickPolish", icon: "polish", prompt: "请润色当前笔记，使其更通顺、专业，保留原意。" },
];

export default function AiChatPanel({ className }: { className?: string }) {
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const activePath = useAppStore((state) => state.activePath);
  const content = useAppStore((state) => state.content);
  const notes = useAppStore((state) => state.notes);
  const openSettings = useAppStore((state) => state.openSettings);
  const setContent = useAppStore((state) => state.setContent);
  const setLibraryPanelMode = useAppStore((state) => state.setLibraryPanelMode);
  const selectNote = useAppStore((state) => state.selectNote);
  const aiSessions = useAppStore((state) => state.aiSessions);
  const activeAiSessionId = useAppStore((state) => state.activeAiSessionId);
  const createAiSession = useAppStore((state) => state.createAiSession);
  const selectAiSession = useAppStore((state) => state.selectAiSession);
  const deleteAiSession = useAppStore((state) => state.deleteAiSession);
  const updateAiSession = useAppStore((state) => state.updateAiSession);
  const createNote = useAppStore((state) => state.createNote);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [useNoteContext, setUseNoteContext] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [insertedId, setInsertedId] = useState<string | null>(null);
  const [insertAsNoteId, setInsertAsNoteId] = useState<string | null>(null);
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  /** sessionId of the currently streaming reply; guards stale event callbacks. */
  const streamingSessionRef = useRef<string | null>(null);

  const configured = isAiConfigured(settings.ai);
  const activeNote = useMemo(
    () => notes.find((note) => note.relativePath === activePath),
    [notes, activePath],
  );
  const activeSession = useMemo(
    () => aiSessions.find((session) => session.id === activeAiSessionId) ?? null,
    [aiSessions, activeAiSessionId],
  );
  const messages = activeSession?.messages ?? [];

  /** id of the newest completed assistant message, used for the regenerate button. */
  const lastDoneAssistantId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && message.status !== "loading" && message.status !== "error") {
        return message.id;
      }
    }
    return null;
  }, [messages]);

  const sessionOptions = useMemo(
    () => [
      { value: NEW_SESSION_VALUE, label: `✦ ${t("ai.newChat")}` },
      ...aiSessions.map((session) => ({
        value: session.id,
        label: session.title || t("ai.newChat"),
      })),
    ],
    [aiSessions, t],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    // ensure there is always a session when the panel is open
    if (configured && !activeSession && aiSessions.length === 0) {
      createAiSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, aiSessions.length]);

  /** Append a streamed piece to a specific assistant message in the store. */
  const appendStreamPiece = (
    sessionId: string,
    messageId: string,
    piece: string,
    kind: "content" | "reasoning",
  ) => {
    const state = useAppStore.getState();
    const session = state.aiSessions.find((item) => item.id === sessionId);
    if (!session) return;
    const key = kind === "content" ? "content" : "reasoning";
    state.updateAiSession(sessionId, {
      messages: session.messages.map((item) =>
        item.id === messageId ? { ...item, [key]: `${item[key] ?? ""}${piece}` } : item,
      ),
    });
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    // Read the freshest session from the store so retry sees the trimmed history.
    const state = useAppStore.getState();
    const session = state.aiSessions.find((item) => item.id === state.activeAiSessionId);
    if (!session) return;
    const sessionId = session.id;
    const userMessage: ChatMessage = {
      id: `m${nextMessageId++}`,
      role: "user",
      content: trimmed,
    };
    const loadingMessage: ChatMessage = {
      id: `m${nextMessageId++}`,
      role: "assistant",
      content: "",
      status: "loading",
    };
    const history = [...session.messages, userMessage];
    updateAiSession(sessionId, {
      messages: [...history, loadingMessage],
      title:
        session.messages.length === 0
          ? sessionTitleFromFirstUserMessage(trimmed)
          : session.title,
    });
    setDraft("");
    setIsSending(true);
    streamingSessionRef.current = sessionId;
    const messageId = loadingMessage.id;
    try {
      const noteContext =
        useNoteContext && activeNote
          ? buildNoteContext(activeNote.title || activeNote.fileName, content)
          : null;
      const payload: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: SYSTEM_ROLE },
      ];
      if (noteContext) {
        payload.push({ role: "system", content: noteContext });
      }
      for (const message of history) {
        payload.push({ role: message.role, content: message.content });
      }
      const reply = await getGateways().ai.chatCompletionStream(
        { messages: payload },
        `req-${sessionId}-${messageId}`,
        (piece) => {
          if (streamingSessionRef.current !== sessionId) return;
          appendStreamPiece(sessionId, messageId, piece, "content");
        },
        (piece) => {
          if (streamingSessionRef.current !== sessionId) return;
          appendStreamPiece(sessionId, messageId, piece, "reasoning");
        },
      );
      // Finalize with the authoritative combined reply (covers non-stream fallback).
      const current = useAppStore.getState();
      const targetSession = current.aiSessions.find((item) => item.id === sessionId);
      if (targetSession) {
        updateAiSession(sessionId, {
          messages: targetSession.messages.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  content: reply.content || item.content,
                  reasoning: reply.reasoning || item.reasoning,
                  status: undefined,
                }
              : item,
          ),
        });
      }
    } catch (error) {
      const current = useAppStore.getState();
      const targetSession = current.aiSessions.find((item) => item.id === sessionId);
      if (targetSession) {
        updateAiSession(sessionId, {
          messages: targetSession.messages.map((item) =>
            item.id === messageId
              ? {
                  ...item,
                  status: "error",
                  error: error instanceof Error ? error.message : String(error),
                }
              : item,
          ),
        });
      }
    } finally {
      streamingSessionRef.current = null;
      setIsSending(false);
    }
  };

  const retry = async () => {
    if (!activeSession) return;
    const errorIndex = messages.findIndex((message) => message.status === "error");
    if (errorIndex < 0) return;
    const errorUserMessage = messages[errorIndex - 1];
    if (!errorUserMessage || errorUserMessage.role !== "user") return;
    updateAiSession(activeSession.id, { messages: messages.slice(0, errorIndex) });
    await send(errorUserMessage.content);
  };

  /** Drop the last exchange and ask the same question again. */
  const regenerateLast = async () => {
    if (!activeSession || isSending) return;
    let lastUserIndex = -1;
    for (let index = activeSession.messages.length - 1; index >= 0; index -= 1) {
      if (activeSession.messages[index].role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) return;
    const lastUserMessage = activeSession.messages[lastUserIndex];
    updateAiSession(activeSession.id, { messages: activeSession.messages.slice(0, lastUserIndex) });
    await send(lastUserMessage.content);
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(
        () => setCopiedId((current) => (current === message.id ? null : current)),
        1600,
      );
    } catch {
      // clipboard unavailable; ignore
    }
  };

  const insertIntoNote = (message: ChatMessage) => {
    if (!activePath) return;
    setContent(content ? `${content}\n\n${message.content}\n` : `${message.content}\n`);
    setInsertedId(message.id);
    window.setTimeout(
      () => setInsertedId((current) => (current === message.id ? null : current)),
      1600,
    );
  };

  const insertAsNewNote = async (message: ChatMessage) => {
    const firstLine = message.content.trim().split("\n")[0] || "AI 笔记";
    const title = firstLine.replace(/^#+\s*/, "").slice(0, 40) || "AI 笔记";
    try {
      await createNote({ title, extension: "md" });
      // createNote selects the new note; now put the reply content into it.
      setContent(message.content + "\n");
      setInsertAsNoteId(message.id);
      window.setTimeout(
        () => setInsertAsNoteId((current) => (current === message.id ? null : current)),
        1600,
      );
    } catch {
      // createNote already surfaces an error via the store error state
    }
  };

  const startNewChat = () => {
    createAiSession();
    setDraft("");
  };

  const closePanel = () => {
    setLibraryPanelMode("notes");
  };

  const handleSessionSelect = (value: string) => {
    if (value === NEW_SESSION_VALUE) {
      startNewChat();
      return;
    }
    selectAiSession(value);
  };

  const handleSwitchNote = (relativePath: string) => {
    void selectNote(relativePath);
  };

  const handleDeleteSession = (session: AiSession) => {
    if (window.confirm(t("ai.sessionConfirm"))) {
      deleteAiSession(session.id);
    }
  };

  const applyQuickCommand = (prompt: string) => {
    const noteContext =
      activeNote && useNoteContext ? `\n\n（当前笔记：${activeNote.title || activeNote.fileName}）` : "";
    void send(`${prompt}${noteContext}`);
  };

  const toggleReasoning = (messageId: string) => {
    setExpandedReasoningIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  return (
    <section aria-label={t("ai.panelTitle")} className={className}>
      <div className="ai-chat-panel flex h-full min-h-0 flex-col bg-canvas">
        <header
          className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border pl-3 pr-2"
          data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
          onMouseDown={handleWindowDragMouseDown}
        >
          <Select
            className="ai-session-picker min-w-0"
            label={t("ai.sessionSelect")}
            onChange={handleSessionSelect}
            options={sessionOptions}
            value={activeAiSessionId ?? NEW_SESSION_VALUE}
          />
          {activeSession && aiSessions.length > 0 && (
            <IconButton
              className="h-7 w-7 shrink-0"
              label={t("ai.sessionDelete")}
              onClick={() => handleDeleteSession(activeSession)}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton className="h-7 w-7 shrink-0" label={t("ai.newChat")} onClick={startNewChat}>
            <MessageSquarePlus className="h-4 w-4" />
          </IconButton>
          <IconButton className="h-7 w-7 shrink-0" label={t("ai.closePanel")} onClick={closePanel}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>

        {!configured ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <div className="ai-setup-card max-w-sm text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-accent" aria-hidden strokeWidth={1.5} />
              <h3 className="text-[15px] font-semibold text-text">{t("ai.setupTitle")}</h3>
              <p className="mt-2 text-[13px] leading-6 text-muted">{t("ai.setupBody")}</p>
              <Button className="mt-4" onClick={() => openSettings("ai")} variant="primary">
                {t("ai.openSettings")}
              </Button>
              {!isTauriRuntime() && (
                <p className="mt-3 text-[12px] text-muted">{t("ai.browserOnlyHint")}</p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
              <Toggle
                checked={useNoteContext}
                label={t("ai.useNoteContext")}
                onChange={setUseNoteContext}
              />
              {useNoteContext && activeNote && (
                <Select
                  className="ai-note-picker ml-auto min-w-0"
                  label={t("ai.notePicker")}
                  onChange={(value) => handleSwitchNote(value)}
                  options={notes.map((note) => ({
                    value: note.relativePath,
                    label: note.title || note.fileName,
                  }))}
                  value={activeNote.relativePath}
                />
              )}
            </div>

            <div
              className="ai-chat-messages min-h-0 flex-1 overflow-y-auto px-3 py-4"
              ref={listRef}
            >
              {messages.length === 0 ? (
                <div className="ai-empty-state mx-auto flex h-full max-w-sm flex-col items-center justify-center text-center">
                  <div className="ai-empty-badge">
                    <Sparkles aria-hidden strokeWidth={1.6} />
                  </div>
                  <h3 className="mt-4 text-[14.5px] font-semibold text-text">
                    {t("ai.emptyTitle")}
                  </h3>
                  <p className="mt-1.5 text-[12.5px] leading-6 text-muted">{t("ai.emptyHint")}</p>
                  {activeNote && useNoteContext ? (
                    <div className="ai-quick-grid mt-5 grid w-full grid-cols-2 gap-2">
                      {QUICK_COMMANDS.map((command) => (
                        <button
                          className="ai-quick-tile"
                          disabled={isSending}
                          key={command.key}
                          onClick={() => applyQuickCommand(command.prompt)}
                          type="button"
                        >
                          <QuickIcon kind={command.icon} />
                          <span className="min-w-0 truncate">{t(command.key)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="ai-no-note-hint mt-5 text-[12px] leading-5 text-muted">
                      {t("ai.noNoteHint")}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {messages.map((message) => (
                    <div
                      className={
                        message.role === "user" ? "ai-bubble-row is-user" : "ai-bubble-row"
                      }
                      key={message.id}
                    >
                      <div
                        className={
                          message.role === "user" ? "ai-bubble is-user" : "ai-bubble is-assistant"
                        }
                      >
                        {message.status === "loading" ? (
                          <span aria-label={t("ai.thinking")} className="ai-typing">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : message.status === "error" ? (
                          <div className="ai-error">
                            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                            <div className="min-w-0">
                              <p>{t("ai.requestFailed")}</p>
                              <p className="ai-error-details">{message.error}</p>
                              <button
                                className="ai-retry-button"
                                onClick={() => void retry()}
                                type="button"
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                {t("ai.retry")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {message.reasoning ? (
                              <div className="ai-reasoning-block">
                                <button
                                  className="ai-reasoning-toggle"
                                  onClick={() => toggleReasoning(message.id)}
                                  type="button"
                                >
                                  {expandedReasoningIds.has(message.id) ? (
                                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                                  )}
                                  <Bot className="h-3.5 w-3.5" aria-hidden />
                                  <span>{t("ai.thinkingLabel")}</span>
                                </button>
                                {expandedReasoningIds.has(message.id) && (
                                  <pre className="ai-reasoning-body">{message.reasoning}</pre>
                                )}
                              </div>
                            ) : null}
                            <div
                              className="ai-markdown"
                              dangerouslySetInnerHTML={{
                                __html: renderMarkdownLite(message.content),
                              }}
                            />
                            {message.role === "assistant" && (
                              <div className="ai-bubble-actions">
                                {message.id === lastDoneAssistantId && (
                                  <button
                                    aria-label={t("ai.regenerate")}
                                    className="ai-action-button"
                                    disabled={isSending}
                                    onClick={() => void regenerateLast()}
                                    title={t("ai.regenerate")}
                                    type="button"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                )}
                                <button
                                  aria-label={
                                    copiedId === message.id ? t("ai.copied") : t("ai.copy")
                                  }
                                  className="ai-action-button"
                                  onClick={() => void copyMessage(message)}
                                  title={t("ai.copy")}
                                  type="button"
                                >
                                  {copiedId === message.id ? (
                                    <Check className="h-3.5 w-3.5" aria-hidden />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" aria-hidden />
                                  )}
                                </button>
                                {activePath && (
                                  <button
                                    aria-label={
                                      insertedId === message.id
                                        ? t("ai.inserted")
                                        : t("ai.insert")
                                    }
                                    className="ai-action-button"
                                    onClick={() => insertIntoNote(message)}
                                    title={t("ai.insert")}
                                    type="button"
                                  >
                                    {insertedId === message.id ? (
                                      <Check className="h-3.5 w-3.5" aria-hidden />
                                    ) : (
                                      <FileText className="h-3.5 w-3.5" aria-hidden />
                                    )}
                                  </button>
                                )}
                                <button
                                  aria-label={
                                    insertAsNoteId === message.id
                                      ? t("ai.insertAsNoteDone")
                                      : t("ai.insertAsNote")
                                  }
                                  className="ai-action-button"
                                  onClick={() => void insertAsNewNote(message)}
                                  title={t("ai.insertAsNote")}
                                  type="button"
                                >
                                  {insertAsNoteId === message.id ? (
                                    <Check className="h-3.5 w-3.5" aria-hidden />
                                  ) : (
                                    <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
                                  )}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ai-composer shrink-0 border-t border-border p-3">
              <textarea
                aria-label={t("ai.inputPlaceholder")}
                className="ai-composer-input"
                disabled={isSending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                placeholder={t("ai.inputPlaceholder")}
                rows={3}
                value={draft}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="ai-model-name min-w-0 truncate" title={settings.ai.model}>
                  {settings.ai.model}
                </span>
                <Button
                  aria-label={t("ai.send")}
                  className="h-8 w-8 shrink-0"
                  disabled={!draft.trim() || isSending}
                  onClick={() => void send(draft)}
                  size="icon"
                  variant="primary"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function QuickIcon({ kind }: { kind: QuickCommandIcon }) {
  switch (kind) {
    case "outline":
      return <ListTree className="h-3.5 w-3.5" aria-hidden />;
    case "title":
      return <Heading1 className="h-3.5 w-3.5" aria-hidden />;
    case "translate":
      return <Languages className="h-3.5 w-3.5" aria-hidden />;
    case "tags":
      return <Tags className="h-3.5 w-3.5" aria-hidden />;
    case "polish":
      return <WandSparkles className="h-3.5 w-3.5" aria-hidden />;
    default:
      return <Sparkles className="h-3.5 w-3.5" aria-hidden />;
  }
}
