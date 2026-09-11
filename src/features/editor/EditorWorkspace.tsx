import {
  Blocks,
  Bold,
  Braces,
  Code,
  ExternalLink,
  FileDown,
  Heading,
  Highlighter,
  History,
  Image,
  Italic,
  LayoutPanelLeft,
  BookOpen,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Network,
  Quote,
  Save,
  Sigma,
  Sparkles,
  SplitSquareHorizontal,
  Star,
  Strikethrough,
  Table,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconButton, Tooltip, cn } from "../../components/ui";
import { fileDropTargetFromPoint, watchNativeFileDrop } from "../../platform/file-drop";
import { isTauriRuntime } from "../../platform/runtime";
import {
  DEFAULT_EDITOR_SPLIT,
  MAX_EDITOR_SPLIT,
  MIN_EDITOR_SPLIT,
} from "../../domain/layout";
import { LayoutResizeHandle } from "../layout/LayoutResizeHandle";
import { useAppStore } from "../../store/app-store";
import { getGateways } from "../../gateways";
import { isAiConfigured } from "../../domain/settings";
import { useI18n } from "../../i18n/react";
import { parseNote } from "../library/note-utils";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { markdownForAttachments } from "../../domain/attachments";
import { mapGatewayError } from "../../domain/errors";
import { revealWorkspaceItem } from "../workspace/workspace-utils";
import { readClipboardImageFiles, readClipboardText } from "./clipboard";
import { EditorContextMenu, type EditorMenuTarget } from "./EditorContextMenu";
import {
  NotePickerDialog,
  RemoteImageDialog,
  type NoteSyntaxDialogState,
} from "./NoteSyntaxDialogs";
import type { EditorHandle } from "./EditorPane";
import { ToolbarDropdownButton } from "./ToolbarDropdownButton";
import { ToolbarMenuItem } from "./ToolbarMenuItem";
import { TableGridPicker } from "./TableGridPicker";
import type { EditorView } from "@codemirror/view";
import {
  toolbarAdvancedCodeBlock,
  toolbarBlockId,
  toolbarBlockPrefix,
  toolbarCallout,
  toolbarCodeBlock,
  toolbarDetails,
  toolbarFootnote,
  toolbarFrontMatter,
  toolbarHeading,
  toolbarHorizontalRule,
  toolbarImage,
  toolbarInline,
  toolbarInlineCode,
  toolbarLink,
  toolbarMathBlock,
  toolbarMermaid,
  toolbarTable,
  toolbarTabs,
  toolbarTag,
  toolbarWrap,
} from "./toolbar-commands";
import {
  bodySourceLineOffset,
  collectPreviewAnchors,
  countDocumentLines,
  lineForScrollTop,
  scrollTopForLine,
  syncViewportOffset,
  type ScrollAnchor,
} from "./scroll-sync";
import { exportNote } from "../export/export-note";
import type { ExportFormat } from "../../gateways/contracts";
import { useNoteGraph } from "../graph/useNoteGraph";
import { VersionsPanel } from "./VersionsPanel";

const EditorPane = lazy(() => import("./EditorPane"));
const PreviewPane = lazy(() => import("../preview/PreviewPane"));
type ScrollPane = "editor" | "preview";

function PaneFallback({ label }: { label: string }) {
  return (
    <div className="grid min-h-0 min-w-0 place-items-center bg-canvas text-sm text-muted">
      {label}
    </div>
  );
}

export const EditorWorkspace = forwardRef<EditorHandle, {
  isDark: boolean;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}>(function EditorWorkspace(
  {
    isDark,
    onRename,
    onDelete,
    className,
  },
  forwardedRef,
) {
  const editorRef = useRef<EditorHandle>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const programmaticScrollTopRef = useRef<Record<ScrollPane, number | null>>({
    editor: null,
    preview: null,
  });
  const lastScrollSourceRef = useRef<ScrollPane | null>(null);
  const pendingScrollRef = useRef<ScrollPane | null>(null);
  const scrollRafRef = useRef(0);
  const anchorCacheRef = useRef<{
    content: string;
    height: number;
    items: ScrollAnchor[];
  } | null>(null);
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const notes = useAppStore((state) => state.notes);
  const activePath = useAppStore((state) => state.activePath);
  const loadedContentPath = useAppStore((state) => state.loadedContentPath);
  const content = useAppStore((state) => state.content);
  const savedContent = useAppStore((state) => state.savedContent);
  const settings = useAppStore((state) => state.settings);
  const viewMode = useAppStore((state) => state.viewMode);
  const editorSplit = useAppStore((state) => state.layout.editorSplit);
  const setLayout = useAppStore((state) => state.setLayout);
  const isSaving = useAppStore((state) => state.isSaving);
  const setContent = useAppStore((state) => state.setContent);
  const handleEditorChange = useCallback(
    (text: string) => {
      if (useAppStore.getState().activePath !== activePath) return;
      setContent(text);
    },
    [activePath, setContent],
  );
  const selectNote = useAppStore((state) => state.selectNote);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const saveActiveNote = useAppStore((state) => state.saveActiveNote);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const savePastedImages = useAppStore((state) => state.savePastedImages);
  const importDroppedImages = useAppStore((state) => state.importDroppedImages);
  const importAttachments = useAppStore((state) => state.importAttachments);
  const { t } = useI18n();
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitWidth, setSplitWidth] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [nativeDropActive, setNativeDropActive] = useState(false);
  const [editorMenu, setEditorMenu] = useState<EditorMenuTarget | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Which toolbar dropdown (by key) currently has its menu open; used to
  // suppress the trigger tooltip while its menu is visible (inkstone parity).
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  // AI selected-text operation is in flight (spinner on the toolbar entry).
  const [aiBusy, setAiBusy] = useState(false);
  // AI is configured at all; hides the right-click AI group when off.
  const aiConfigured = isAiConfigured(settings.ai);
  // Success toast after an AI operation replaced the selection.
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const aiNoticeTimer = useRef(0);
  // Pending note-syntax picker behind the "note syntax" menu: choose a note
  // (or paste a remote image URL) instead of inserting an empty token.
  const [noteSyntaxDialog, setNoteSyntaxDialog] = useState<NoteSyntaxDialogState>(null);
  const { graph } = useNoteGraph();
  const untitled = t("editor.untitledFallback");
  const activeNote = notes.find((note) => note.relativePath === activePath) || null;
  const hasDocument = Boolean(activeNote && loadedContentPath === activePath);
  const parsed = useMemo(
    () => parseNote(hasDocument ? content : "", activeNote?.fileName || untitled),
    [activeNote?.fileName, content, hasDocument, untitled],
  );
  const isDirty = hasDocument && content !== savedContent;

  useLayoutEffect(() => {
    if (viewMode !== "split" || !hasDocument) {
      setSplitWidth(0);
      return;
    }
    const split = splitRef.current;
    if (!split || typeof ResizeObserver === "undefined") return;
    const update = () => setSplitWidth(split.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(split);
    return () => observer.disconnect();
  }, [hasDocument, viewMode]);

  const applyScrollTop = useCallback(
    (pane: ScrollPane, element: HTMLElement, nextTop: number) => {
      if (Math.abs(element.scrollTop - nextTop) < 1) return;
      element.scrollTop = nextTop;
      programmaticScrollTopRef.current[pane] = element.scrollTop;
    },
    [],
  );

  const consumeProgrammaticScroll = useCallback((source: ScrollPane) => {
    const expectedTop = programmaticScrollTopRef.current[source];
    if (expectedTop === null) return false;
    programmaticScrollTopRef.current[source] = null;
    const scroller =
      source === "editor" ? editorRef.current?.getScrollElement() : previewPaneRef.current;
    return Boolean(scroller && Math.abs(scroller.scrollTop - expectedTop) < 1);
  }, []);

  const getPreviewAnchors = useCallback(() => {
    const previewScroller = previewPaneRef.current;
    if (!previewScroller) return [];
    const cached = anchorCacheRef.current;
    if (cached && cached.content === content && cached.height === previewScroller.scrollHeight) {
      return cached.items;
    }
    const items = collectPreviewAnchors(
      previewScroller,
      bodySourceLineOffset(content, parsed.body),
    );
    anchorCacheRef.current = {
      content,
      height: previewScroller.scrollHeight,
      items,
    };
    return items;
  }, [content, parsed.body]);

  const performScrollSync = useCallback(
    (source: ScrollPane) => {
      const editor = editorRef.current;
      const editorScroller = editor?.getScrollElement();
      const previewScroller = previewPaneRef.current;
      if (!editor || !editorScroller || !previewScroller) return;
      const lastLine = countDocumentLines(content);
      const anchors = getPreviewAnchors();
      const editorOffset = syncViewportOffset(editorScroller.clientHeight);
      const previewOffset = syncViewportOffset(previewScroller.clientHeight);
      lastScrollSourceRef.current = source;
      if (source === "editor") {
        const line = editor.getVisibleLine(editorOffset);
        if (line == null) return;
        applyScrollTop(
          "preview",
          previewScroller,
          scrollTopForLine(line, anchors, previewScroller, lastLine, previewOffset),
        );
        return;
      }
      const previousTop = editorScroller.scrollTop;
      editor.scrollToLine(
        lineForScrollTop(previewScroller.scrollTop, anchors, previewScroller, lastLine, previewOffset),
        editorOffset,
      );
      if (Math.abs(editorScroller.scrollTop - previousTop) >= 1) {
        programmaticScrollTopRef.current.editor = editorScroller.scrollTop;
      }
    },
    [applyScrollTop, content, getPreviewAnchors],
  );

  const syncScroll = useCallback(
    (source: ScrollPane) => {
      if (consumeProgrammaticScroll(source)) return;
      pendingScrollRef.current = source;
      if (scrollRafRef.current) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        const pending = pendingScrollRef.current;
        pendingScrollRef.current = null;
        if (pending) performScrollSync(pending);
      });
    },
    [consumeProgrammaticScroll, performScrollSync],
  );

  useEffect(() => {
    programmaticScrollTopRef.current.editor = null;
    programmaticScrollTopRef.current.preview = null;
    anchorCacheRef.current = null;
  }, [activePath]);

  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const previewObserverRef = useRef<ResizeObserver | null>(null);

  const attachPreviewArticle = useCallback(
    (node: HTMLElement | null) => {
      previewObserverRef.current?.disconnect();
      previewObserverRef.current = null;
      if (!node) return;
      const observer = new ResizeObserver(() => {
        if (viewModeRef.current !== "split") return;
        anchorCacheRef.current = null;
        if (lastScrollSourceRef.current === "preview") return;
        performScrollSync("editor");
      });
      observer.observe(node);
      previewObserverRef.current = observer;
    },
    [performScrollSync],
  );

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
      previewObserverRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void watchNativeFileDrop((event) => {
      if (event.type === "leave") {
        setNativeDropActive(false);
        return;
      }
      const overEditor = fileDropTargetFromPoint(event.x, event.y) === "editor";
      if (event.type === "hover") {
        setNativeDropActive(overEditor);
        return;
      }
      setNativeDropActive(false);
      if (!overEditor) return;
      void importDroppedImages(event.paths).then((markdown) => {
        if (markdown) editorRef.current?.insertTextAtCoords(event.x, event.y, markdown);
      });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [importDroppedImages]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getScrollElement: () => editorRef.current?.getScrollElement() ?? null,
      getVisibleLine: (offset) => editorRef.current?.getVisibleLine(offset) ?? null,
      scrollToLine: (line, offset) => editorRef.current?.scrollToLine(line, offset),
      insertSnippet: (before, after, placeholder) =>
        editorRef.current?.insertSnippet(before, after, placeholder),
      insertText: (text) => editorRef.current?.insertText(text),
      replaceSelection: (text) => editorRef.current?.replaceSelection(text),
      insertTextAtCoords: (x, y, text) => editorRef.current?.insertTextAtCoords(x, y, text),
      insertRaw: (text) => editorRef.current?.insertRaw(text),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
      selectAll: () => editorRef.current?.selectAll(),
      getSelectedText: () => editorRef.current?.getSelectedText() ?? "",
      cut: () => editorRef.current?.cut() ?? Promise.resolve(),
      copy: () => editorRef.current?.copy() ?? Promise.resolve(),
    }),
    [],
  );

  const openEditorMenu = useCallback((target: EditorMenuTarget) => {
    setEditorMenu(target);
  }, []);

  const ensureEditorMounted = useCallback(async () => {
    // In preview mode the editor is not mounted, so inserts would silently
    // do nothing. Switch to split view first so the markdown lands visibly.
    if (viewModeRef.current === "preview") {
      setViewMode("split");
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }, [setViewMode]);

  const pasteIntoEditor = useCallback(async () => {
    await ensureEditorMounted();
    const files = await readClipboardImageFiles();
    if (files.length) {
      const markdown = await savePastedImages(files);
      if (markdown) editorRef.current?.insertText(markdown);
      return;
    }
    const text = await readClipboardText();
    if (text) editorRef.current?.insertRaw(text);
  }, [ensureEditorMounted, savePastedImages]);

  const exportActiveNote = useCallback(
    async (format: ExportFormat) => {
      if (!activePath || isExporting) return;
      setIsExporting(true);
      try {
        await exportNote(activePath, format);
      } finally {
        setIsExporting(false);
      }
    },
    [activePath, isExporting],
  );

  const insertImportedImages = useCallback(async () => {
    await ensureEditorMounted();
    const imported = await importAttachments();
    const markdown = markdownForAttachments(useAppStore.getState().activePath, imported);
    if (markdown) editorRef.current?.insertText(markdown);
  }, [ensureEditorMounted, importAttachments]);

  // Toolbar actions run in the live CodeMirror view (undoable single steps).
  // The editor ref callback hands us the view whenever it mounts/changes.
  const editorViewRef = useRef<EditorView | null>(null);
  const handleEditorView = useCallback((view: EditorView | null) => {
    editorViewRef.current = view;
  }, []);

  const withView = useCallback(
    (run: (view: EditorView) => void) => {
      const view = editorViewRef.current;
      if (!view) {
        void ensureEditorMounted().then(() => {
          const next = editorViewRef.current;
          if (next) run(next);
        });
        return;
      }
      run(view);
    },
    [ensureEditorMounted],
  );

  const runInline = useCallback(
    (format: Parameters<typeof toolbarInline>[1]) => withView((view) => toolbarInline(view, format)),
    [withView],
  );
  const runBlockPrefix = useCallback(
    (kind: Parameters<typeof toolbarBlockPrefix>[1]) =>
      withView((view) => toolbarBlockPrefix(view, kind)),
    [withView],
  );
  const runHeading = useCallback(
    (level: 1 | 2 | 3 | 4 | 5 | 6) => withView((view) => toolbarHeading(view, level)),
    [withView],
  );
  const runWrap = useCallback(
    (open: string, close?: string) => withView((view) => toolbarWrap(view, open, close)),
    [withView],
  );
  const runInlineCode = useCallback(() => withView((view) => toolbarInlineCode(view)), [withView]);
  const runLink = useCallback(() => withView((view) => toolbarLink(view)), [withView]);
  const runTag = useCallback(() => withView((view) => toolbarTag(view)), [withView]);
  const runBlockId = useCallback(() => withView((view) => toolbarBlockId(view)), [withView]);
  const runFootnote = useCallback(() => withView((view) => toolbarFootnote(view)), [withView]);
  const runCallout = useCallback(() => withView((view) => toolbarCallout(view)), [withView]);
  const runDetails = useCallback(() => withView((view) => toolbarDetails(view)), [withView]);
  const runMermaid = useCallback(() => withView((view) => toolbarMermaid(view)), [withView]);
  const runCodeBlock = useCallback(() => withView((view) => toolbarCodeBlock(view)), [withView]);
  const runAdvancedCodeBlock = useCallback(
    () => withView((view) => toolbarAdvancedCodeBlock(view)),
    [withView],
  );
  const runTable = useCallback(
    (rows = 1, cols = 3) =>
      withView((view) => toolbarTable(view, t("toolbar.tableHeaderRow"), rows, cols)),
    [t, withView],
  );
  const runHorizontalRule = useCallback(
    () => withView((view) => toolbarHorizontalRule(view)),
    [withView],
  );
  const runMathBlock = useCallback(() => withView((view) => toolbarMathBlock(view)), [withView]);
  const runFrontMatter = useCallback(() => withView((view) => toolbarFrontMatter(view)), [withView]);

  // The "note syntax" picker inserts ready-made tokens at the live cursor
  // (via insertRaw so wiki markup is not re-wrapped), then refocuses.
  const insertNoteSyntaxToken = useCallback(
    (token: string) => {
      withView((view) => {
        view.dispatch({
          changes: { from: view.state.selection.main.from, to: view.state.selection.main.to, insert: token },
          selection: { anchor: view.state.selection.main.from + token.length },
          scrollIntoView: true,
          userEvent: "input.toolbar",
        });
        view.focus();
      });
    },
    [withView],
  );
  const insertRemoteImage = useCallback(
    (url: string) => withView((view) => toolbarImage(view, url)),
    [withView],
  );
  const runTabs = useCallback(
    () => withView((view) => toolbarTabs(view, t("toolbar.tab1"), t("toolbar.tab2"))),
    [t, withView],
  );

  const showAiNotice = useCallback((message: string) => {
    window.clearTimeout(aiNoticeTimer.current);
    setAiNotice(message);
    aiNoticeTimer.current = window.setTimeout(() => setAiNotice(null), 2400);
  }, []);

  useEffect(
    () => () => window.clearTimeout(aiNoticeTimer.current),
    [],
  );

  // AI assisted editing: run an operation on the current selection and
  // replace it with the streamed result.
  const runAiOnSelection = useCallback(
    async (kind: "expand" | "polish" | "summarize" | "translate") => {
      if (aiBusy) return;
      if (!isAiConfigured(useAppStore.getState().settings.ai)) {
        useAppStore.setState({
          error: t("ai.setupTitle"),
        });
        return;
      }
      const selected = editorRef.current?.getSelectedText() ?? "";
      if (!selected.trim()) {
        useAppStore.setState({
          error: t("editor.aiSelectHint"),
        });
        return;
      }
      await ensureEditorMounted();
      const latestSelected = editorRef.current?.getSelectedText() ?? "";
      if (!latestSelected.trim()) {
        useAppStore.setState({
          error: t("editor.aiSelectHint"),
        });
        return;
      }
      setAiBusy(true);
      try {
        const prompts: Record<string, string> = {
          expand: `请扩写以下内容，使其更详细、更丰富，保持原意，直接输出扩写结果（不要任何解释）：\n\n${latestSelected}`,
          polish: `请润色以下内容，使其更通顺、专业，保留原意，直接输出润色结果（不要任何解释）：\n\n${latestSelected}`,
          summarize: `请用简洁的语言总结以下内容要点，直接输出总结结果（不要任何解释）：\n\n${latestSelected}`,
          translate: `请将以下内容翻译成英文，保留 Markdown 格式，直接输出翻译结果（不要任何解释）：\n\n${latestSelected}`,
        };
        const system = `你是用户的 AI 写作助手。请始终使用简体中文回复（翻译任务除外），语气自然专业。直接输出结果，不要任何解释或前缀。`;
        const reply = await getGateways().ai.chatCompletionStream(
          {
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompts[kind] },
            ],
          },
          `req-editor-${Date.now()}`,
          () => {
            /* progress is not streamed into the editor; we await the final result */
          },
          () => {
            /* reasoning pieces are not surfaced in the inline toolbar */
          },
        );
        const result = reply.content.trim();
        if (result) {
          editorRef.current?.replaceSelection(result);
          const doneKeys = {
            expand: "editor.aiDoneExpand",
            polish: "editor.aiDonePolish",
            summarize: "editor.aiDoneSummarize",
            translate: "editor.aiDoneTranslate",
          } as const;
          showAiNotice(t(doneKeys[kind]));
        }
      } catch (error) {
        useAppStore.setState({
          error: t("ai.errors.chat", {
            message: mapGatewayError(error).message,
          }),
        });
      } finally {
        setAiBusy(false);
      }
    },
    [aiBusy, mapGatewayError, showAiNotice, t],
  );

  type ToolbarEntry =
    | { kind: "divider"; key: string }
    | {
        kind: "button";
        key: string;
        label: string;
        combo?: string;
        icon: typeof Bold;
        action: () => void;
      }
    | {
        kind: "table";
        key: string;
        label: string;
        icon: typeof Bold;
      }
    | {
        kind: "dropdown";
        key: string;
        label: string;
        icon: typeof Bold;
        menu: "heading" | "inline" | "note" | "block" | "ai";
        width: number;
      };

  const toolbar: ToolbarEntry[] = [
    // Group 1: heading dropdown.
    {
      kind: "dropdown",
      key: "heading",
      label: t("toolbar.heading"),
      icon: Heading,
      menu: "heading",
      width: 168,
    },
    { kind: "divider", key: "d1" },
    // Group 2: inline styles.
    { kind: "button", key: "bold", label: t("toolbar.bold"), combo: "mod+b", icon: Bold, action: () => runInline("bold") },
    { kind: "button", key: "italic", label: t("toolbar.italic"), combo: "mod+i", icon: Italic, action: () => runInline("italic") },
    { kind: "button", key: "strikethrough", label: t("toolbar.strikethrough"), combo: "mod+shift+x", icon: Strikethrough, action: () => runInline("strikethrough") },
    { kind: "button", key: "code", label: t("toolbar.code"), combo: "mod+e", icon: Code, action: runInlineCode },
    { kind: "dropdown", key: "moreInline", label: t("toolbar.moreInlineStyles"), icon: Highlighter, menu: "inline", width: 184 },
    { kind: "divider", key: "d2" },
    // Group 3: lists.
    { kind: "button", key: "bullet", label: t("toolbar.bulletList"), combo: "mod+shift+8", icon: List, action: () => runBlockPrefix("bullet") },
    { kind: "button", key: "ordered", label: t("toolbar.orderedList"), combo: "mod+shift+7", icon: ListOrdered, action: () => runBlockPrefix("ordered") },
    { kind: "button", key: "task", label: t("toolbar.taskList"), combo: "mod+shift+9", icon: ListTodo, action: () => runBlockPrefix("task") },
    { kind: "button", key: "quote", label: t("toolbar.quote"), combo: "mod+shift+.", icon: Quote, action: () => runBlockPrefix("quote") },
    { kind: "divider", key: "d3" },
    // Group 4: links & note syntax.
    { kind: "button", key: "link", label: t("toolbar.link"), icon: Link2, action: runLink },
    { kind: "button", key: "image", label: t("toolbar.image"), icon: Image, action: () => void insertImportedImages() },
    { kind: "dropdown", key: "noteSyntax", label: t("toolbar.noteSyntax"), icon: Network, menu: "note", width: 184 },
    { kind: "divider", key: "d4" },
    // Group 5: blocks.
    { kind: "button", key: "codeBlock", label: t("toolbar.codeBlock"), icon: Braces, action: runCodeBlock },
    { kind: "table", key: "table", label: t("toolbar.table"), icon: Table },
    { kind: "button", key: "math", label: t("toolbar.math"), icon: Sigma, action: runMathBlock },
    { kind: "button", key: "rule", label: t("toolbar.rule"), icon: Minus, action: runHorizontalRule },
    { kind: "dropdown", key: "moreBlocks", label: t("toolbar.moreBlocks"), icon: Blocks, menu: "block", width: 192 },
    // Group 6: AI assisted editing on the current selection.
    { kind: "divider", key: "d5" },
    {
      kind: "dropdown",
      key: "aiEdit",
      label: t("toolbar.aiEdit"),
      icon: Sparkles,
      menu: "ai",
      width: 160,
    },
  ];

  return (
    <section
      className={cn(
        "editor-workspace grid h-full min-h-0 min-w-0 grid-rows-[56px_42px_minmax(0,1fr)] bg-canvas",
        className,
      )}
    >
      <header
        className="workspace-header flex min-w-0 items-center justify-between border-b border-border px-4"
        data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
      >
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-text">
            {hasDocument ? parsed.title : t("editor.noNoteTitle")}
          </h2>
          <p className="mt-0.5 truncate text-[10px] text-muted">
            {hasDocument ? activePath : t("editor.noNoteSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            aria-label={isSaving ? t("editor.saving") : isDirty ? t("editor.unsaved") : t("editor.saved")}
            aria-live="polite"
            className="save-state-dot mr-1"
            data-state={isSaving ? "saving" : isDirty ? "dirty" : "saved"}
            role="status"
            title={isSaving ? t("editor.saving") : isDirty ? t("editor.unsaved") : t("editor.saved")}
          />
          <div className="view-switcher flex items-center rounded-lg p-0.5">
            <IconButton
              active={viewMode === "edit"}
              label={t("editor.edit")}
              onClick={() => setViewMode("edit")}
            >
              <BookOpen className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              active={viewMode === "split"}
              label={t("editor.split")}
              onClick={() => setViewMode("split")}
            >
              <SplitSquareHorizontal className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              active={viewMode === "preview"}
              label={t("editor.preview")}
              onClick={() => setViewMode("preview")}
            >
              <LayoutPanelLeft className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <IconButton active={activeNote?.favorite} label={t("editor.favorite")} onClick={() => void toggleFavorite()}>
            <Star className={cn("h-4 w-4 transition-colors duration-150", activeNote?.favorite && "fill-accent")} />
          </IconButton>
          <IconButton label={t("editor.save")} onClick={() => void saveActiveNote()}>
            <Save className="h-4 w-4" />
          </IconButton>
          <Tooltip label={isExporting ? t("editor.exporting") : t("editor.export")} suppress={openDropdownKey === "export"}>
            <ToolbarDropdownButton
              disabled={!hasDocument || isExporting}
              icon={<FileDown className="h-3.5 w-3.5" />}
              label={t("editor.export")}
              onOpenChange={(isOpen) => setOpenDropdownKey(isOpen ? "export" : null)}
              width={200}
            >
              {(close) => (
                <>
                  <ToolbarMenuItem
                    label={t("editor.exportWord")}
                    onSelect={() => {
                      close();
                      void exportActiveNote("word");
                    }}
                  />
                  <ToolbarMenuItem
                    label={t("editor.exportHtml")}
                    onSelect={() => {
                      close();
                      void exportActiveNote("html");
                    }}
                  />
                  <ToolbarMenuItem
                    label={t("editor.exportMarkdown")}
                    onSelect={() => {
                      close();
                      void exportActiveNote("markdown");
                    }}
                  />
                  <ToolbarMenuItem
                    label={t("editor.exportPdf")}
                    onSelect={() => {
                      close();
                      void exportActiveNote("pdf");
                    }}
                    separatorBefore
                  />
                </>
              )}
            </ToolbarDropdownButton>
          </Tooltip>
          <IconButton
            className="max-[760px]:hidden"
            disabled={!hasDocument}
            label={t("editor.versions")}
            onClick={() => setVersionsOpen(true)}
          >
            <History className="h-4 w-4" />
          </IconButton>
          <IconButton
            className="max-[760px]:hidden"
            label={t("editor.openInSystem")}
            onClick={() => {
              if (!workspaceRoot || !activePath) return;
              void revealWorkspaceItem(workspaceRoot, activePath).catch((error) => {
                useAppStore.setState({
                  error: t("errors.openInSystem", { message: mapGatewayError(error).message }),
                });
              });
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </IconButton>
          <IconButton className="max-[760px]:hidden" label={t("editor.rename")} onClick={() => onRename()}>
            <Braces className="h-4 w-4" />
          </IconButton>
          <IconButton className="max-[760px]:hidden" label={t("editor.delete")} onClick={() => onDelete()}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </header>
      <div
        aria-label={t("editor.toolbar")}
        className="markdown-toolbar flex items-center gap-0.5 overflow-x-auto border-b border-border px-3.5"
        role="toolbar"
      >
        {toolbar.map((entry) =>
          entry.kind === "divider" ? (
            <span aria-hidden="true" className="toolbar-group-divider" key={entry.key} />
          ) : entry.kind === "dropdown" ? (
            <Tooltip
              key={entry.key}
              label={entry.key === "aiEdit" && aiBusy ? t("editor.aiBusy") : entry.label}
              suppress={openDropdownKey === entry.key}
            >
              <ToolbarDropdownButton
                disabled={entry.key === "aiEdit" && aiBusy}
                icon={
                  entry.key === "aiEdit" && aiBusy ? (
                    <span className="toolbar-ai-spinning" role="status">
                      <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <entry.icon className="h-3.5 w-3.5" />
                  )
                }
                label={entry.label}
                onOpenChange={(isOpen) => setOpenDropdownKey(isOpen ? entry.key : null)}
                width={entry.width}
              >
                {(close) =>
                  entry.menu === "heading" ? (
                    <HeadingMenuItems
                      currentLevel={null}
                      onSelect={(level) => {
                        close();
                        runHeading(level);
                      }}
                    />
                  ) : entry.menu === "inline" ? (
                    <>
                      <ToolbarMenuItem
                        combo="mod+shift+h"
                        label={t("toolbar.highlight")}
                        onSelect={() => {
                          close();
                          runInline("highlight");
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.inlineMath")}
                        onSelect={() => {
                          close();
                          runInline("inlineMath");
                        }}
                        separatorBefore
                      />
                    </>
                  ) : entry.menu === "note" ? (
                    <>
                      <ToolbarMenuItem
                        label={t("toolbar.wikiLink")}
                        onSelect={() => {
                          close();
                          setNoteSyntaxDialog({ kind: "notePicker", embed: false });
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.noteEmbed")}
                        onSelect={() => {
                          close();
                          setNoteSyntaxDialog({ kind: "notePicker", embed: true });
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.remoteImage")}
                        onSelect={() => {
                          close();
                          setNoteSyntaxDialog({ kind: "remoteImage" });
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.tag")}
                        onSelect={() => {
                          close();
                          runTag();
                        }}
                        separatorBefore
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.blockId")}
                        onSelect={() => {
                          close();
                          runBlockId();
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.blockReference")}
                        onSelect={() => {
                          close();
                          runWrap("[[#^", "]]");
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.footnote")}
                        onSelect={() => {
                          close();
                          runFootnote();
                        }}
                        separatorBefore
                      />
                    </>
                  ) : entry.menu === "ai" ? (
                    <>
                      <ToolbarMenuItem
                        icon={<WandSparkles className="h-3.5 w-3.5" />}
                        label={t("editor.aiExpand")}
                        onSelect={() => {
                          close();
                          void runAiOnSelection("expand");
                        }}
                      />
                      <ToolbarMenuItem
                        icon={<WandSparkles className="h-3.5 w-3.5" />}
                        label={t("editor.aiPolish")}
                        onSelect={() => {
                          close();
                          void runAiOnSelection("polish");
                        }}
                      />
                      <ToolbarMenuItem
                        icon={<WandSparkles className="h-3.5 w-3.5" />}
                        label={t("editor.aiSummarize")}
                        onSelect={() => {
                          close();
                          void runAiOnSelection("summarize");
                        }}
                      />
                      <ToolbarMenuItem
                        icon={<WandSparkles className="h-3.5 w-3.5" />}
                        label={t("editor.aiTranslate")}
                        onSelect={() => {
                          close();
                          void runAiOnSelection("translate");
                        }}
                        separatorBefore
                      />
                    </>
                  ) : (
                    <>
                      <ToolbarMenuItem
                        label={t("toolbar.menuMermaid")}
                        onSelect={() => {
                          close();
                          runMermaid();
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.enhancedCodeBlock")}
                        onSelect={() => {
                          close();
                          runAdvancedCodeBlock();
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.menuCallout")}
                        onSelect={() => {
                          close();
                          runCallout();
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.menuDetails")}
                        onSelect={() => {
                          close();
                          runDetails();
                        }}
                      />
                      <ToolbarMenuItem
                        label={t("toolbar.menuTabs")}
                        onSelect={() => {
                          close();
                          runTabs();
                        }}
                      />
                      <ToolbarMenuItem
                        label="Front Matter"
                        onSelect={() => {
                          close();
                          runFrontMatter();
                        }}
                        separatorBefore
                      />
                    </>
                  )
                }
              </ToolbarDropdownButton>
            </Tooltip>
          ) : entry.kind === "table" ? (
            <TableGridPicker
              icon={<entry.icon className="h-3.5 w-3.5" />}
              key={entry.key}
              label={entry.label}
              onPick={(rows, cols) => runTable(rows, cols)}
            />
          ) : (
            <Tooltip combo={entry.combo} key={entry.key} label={entry.label}>
              <IconButton
                className="format-button"
                label={entry.label}
                onClick={entry.action}
                title=""
              >
                <entry.icon className="h-3.5 w-3.5" />
              </IconButton>
            </Tooltip>
          ),
        )}
      </div>

      {!hasDocument ? (
        <div className="grid place-items-center p-6 text-center">
          <div>
            <h2 className="text-lg font-bold text-text">{t("editor.emptyTitle")}</h2>
            <p className="mt-2 text-sm text-muted">{t("editor.emptyBody")}</p>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid min-h-0 min-w-0 overflow-hidden",
            viewMode === "split" && "editor-workspace-split",
            viewMode !== "split" && "grid-cols-1",
          )}
          ref={splitRef}
          style={
            viewMode === "split"
              ? {
                  ["--editor-split" as string]: `${editorSplit}fr`,
                  ["--editor-split-rest" as string]: `${1 - editorSplit}fr`,
                }
              : undefined
          }
        >
          {viewMode !== "preview" && (
            <div className="relative grid h-full min-h-0 min-w-0">
              <Suspense fallback={<PaneFallback label={t("editor.loadingEditor")} />}>
                <EditorPane
                  content={content}
                  fileName={activeNote?.fileName || untitled}
                  isDark={isDark}
                  key={activePath || ""}
                  onChange={handleEditorChange}
                  highlightDrop={nativeDropActive}
                  onContextMenu={openEditorMenu}
                  onEditorView={handleEditorView}
                  onOpenNote={(path) => void selectNote(path)}
                  onPasteImages={savePastedImages}
                  onScroll={() => syncScroll("editor")}
                  ref={editorRef}
                  settings={settings}
                  sourcePath={activePath || ""}
                  wikiCatalog={graph.nodes}
                />
              </Suspense>
              {viewMode === "split" && (
                <LayoutResizeHandle
                  defaultValue={splitWidth * DEFAULT_EDITOR_SPLIT}
                  disabled={splitWidth <= 0}
                  label={t("layout.resizeEditor")}
                  max={splitWidth * MAX_EDITOR_SPLIT}
                  min={splitWidth * MIN_EDITOR_SPLIT}
                  onChange={(editorPx) => {
                    if (splitWidth <= 0) return;
                    setLayout({ editorSplit: editorPx / splitWidth });
                  }}
                  value={splitWidth * editorSplit}
                />
              )}
            </div>
          )}
          {viewMode !== "edit" && (
            <Suspense fallback={<PaneFallback label={t("editor.loadingPreview")} />}>
              <PreviewPane
                activePath={activePath}
                articleRef={attachPreviewArticle}
                content={content}
                note={activeNote}
                onContentChange={setContent}
                onScroll={() => syncScroll("preview")}
                paneRef={previewPaneRef}
                root={workspaceRoot}
              />
            </Suspense>
          )}
        </div>
      )}
      <EditorContextMenu
        aiBusy={aiBusy}
        aiEnabled={aiConfigured}
        onAiAction={(kind) => void runAiOnSelection(kind)}
        onClose={() => setEditorMenu(null)}
        onCopy={() => void editorRef.current?.copy()}
        onCut={() => void editorRef.current?.cut()}
        onPaste={() => void pasteIntoEditor()}
        onRedo={() => editorRef.current?.redo()}
        onSelectAll={() => {
          editorRef.current?.selectAll();
          window.requestAnimationFrame(() => editorRef.current?.selectAll());
        }}
        onUndo={() => editorRef.current?.undo()}
        target={editorMenu}
      />
      {aiNotice && (
        <div className="editor-ai-notice" role="status">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
          {aiNotice}
        </div>
      )}
      <NotePickerDialog
        catalog={graph.nodes}
        embed={noteSyntaxDialog?.kind === "notePicker" ? noteSyntaxDialog.embed : false}
        onClose={() => setNoteSyntaxDialog(null)}
        onInsert={insertNoteSyntaxToken}
        open={noteSyntaxDialog?.kind === "notePicker"}
      />
      <RemoteImageDialog
        onClose={() => setNoteSyntaxDialog(null)}
        onInsert={insertRemoteImage}
        open={noteSyntaxDialog?.kind === "remoteImage"}
      />
      {versionsOpen && <VersionsPanel onClose={() => setVersionsOpen(false)} />}
    </section>
  );
});

function HeadingMenuItems({
  currentLevel,
  onSelect,
}: {
  currentLevel: 1 | 2 | 3 | 4 | 5 | 6 | null;
  onSelect: (level: 1 | 2 | 3 | 4 | 5 | 6) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {([1, 2, 3, 4, 5, 6] as const).map((level) => (
        <ToolbarMenuItem
          checked={currentLevel === level}
          combo={`mod+${level}`}
          key={level}
          label={t(`toolbar.headingLevel${level}` as Parameters<typeof t>[0])}
          onSelect={() => onSelect(level)}
        />
      ))}
    </>
  );
}

export default EditorWorkspace;
