import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageDown,
  Maximize2,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  UnfoldHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  Dialog,
  IconButton,
  Input,
  cn,
} from "../../components/ui";
import { useI18n } from "../../i18n/react";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { extractMindHeadings, type MindHeading } from "./mindmap-editing";
import { applyHeadingEdit } from "./mindmap-editing";
import { exportMindmap } from "./export-mindmap";

type MindNode = {
  content: string;
  payload?: { line: number; depth: number };
  children: MindNode[];
};

const isMindNodeGroup = (element: Element | null): element is SVGGElement =>
  Boolean(element) && element!.tagName === "g";

/**
 * Build an IPureNode-compatible tree from heading lines. The root is a virtual
 * node (line -1); each heading becomes a node carrying its original markdown
 * line number in `payload.line`, which markmap preserves when rendering.
 */
export function buildMindTree(headings: MindHeading[]): MindNode {
  const root: MindNode = { content: "", children: [] };
  if (!headings.length) return root;

  const stack: MindNode[] = [root];
  for (const heading of headings) {
    // find the nearest ancestor that is shallower than this heading
    while (stack.length > 1 && stack[stack.length - 1]!.payload!.depth >= heading.depth) {
      stack.pop();
    }
    const node: MindNode = {
      content: heading.text,
      payload: { line: heading.line, depth: heading.depth },
      children: [],
    };
    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return root;
}

function themeColors() {
  const read = (name: string, fallback: string) =>
    typeof document === "undefined"
      ? fallback
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  return {
    canvas: read("--memoir-canvas", "#fbfaf6"),
    text: read("--memoir-text", "#292a27"),
    accent: read("--memoir-accent", "#1E6BFF"),
    accentContrast: read("--memoir-accent-contrast", "#ffffff"),
    border: read("--memoir-border", "#e7e3db"),
    elevated: read("--memoir-elevated", "#fffefb"),
    muted: read("--memoir-muted", "#8c8982"),
    dark: typeof document !== "undefined" && document.documentElement.dataset.theme === "dark",
  };
}

export default function MindMapView({ className }: { className?: string }) {
  const activePath = useAppStore((state) => state.activePath);
  const content = useAppStore((state) => state.content);
  const setContent = useAppStore((state) => state.setContent);
  const notes = useAppStore((state) => state.notes);
  const { t } = useI18n();

type MarkmapInstance = import("markmap-view").Markmap;

const hostRef = useRef<SVGSVGElement>(null);
  const markmapRef = useRef<MarkmapInstance | null>(null);

  const activeNote = notes.find((note) => note.relativePath === activePath) || null;
  const headings = useMemo(
    () => (activePath ? extractMindHeadings(content) : []),
    [activePath, content],
  );
  const tree = useMemo(() => buildMindTree(headings), [headings]);

  // Keep the latest tree so the async markmap init can render it once ready.
  const treeRef = useRef(tree);
  treeRef.current = tree;

  /** Set the tree then fit once the layout is committed, so the first view is
   *  centered instead of showing whatever pan offset markmap starts with. */
  const rerender = async (mm: MarkmapInstance, level: number) => {
    await mm.setData(treeRef.current, { initialExpandLevel: level });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await mm.fit(1.6);
  };

  // Initialize markmap once on mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    void import("markmap-view").then(async ({ Markmap }) => {
      if (disposed || !hostRef.current) return;
      const mm = Markmap.create(hostRef.current, {
        autoFit: false,
        initialExpandLevel: 4,
        duration: 300,
        maxWidth: 280,
        paddingX: 14,
        spacingVertical: 6,
        color: () => {
            const tc = themeColors();
            return tc.dark
              ? `color-mix(in srgb, ${tc.accent} 65%, ${tc.muted})`
              : tc.accent;
          },
        lineWidth: () => 1.5,
      });
      markmapRef.current = mm;
      // The mount-time render effect already ran with a null ref, so render
      // the current tree here once the instance is ready. Skip when there is
      // nothing to show yet (no note / no headings) to keep the canvas blank.
      if (treeRef.current.children.length > 0) {
        await rerender(mm, 4);
      }
    });
    return () => {
      disposed = true;
      markmapRef.current?.destroy();
      markmapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render the tree whenever content or active note changes.
  useEffect(() => {
    const mm = markmapRef.current;
    if (!mm) return;
    void rerender(mm, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // Watch theme changes and refresh colors.
  const appearance = useAppStore((state) => state.settings.appearance);
  useEffect(() => {
    const mm = markmapRef.current;
    if (!mm) return;
    mm.setOptions({
      color: () => {
        const tc = themeColors();
        return tc.dark
          ? `color-mix(in srgb, ${tc.accent} 65%, ${tc.muted})`
          : tc.accent;
      },
    });
    mm.updateStyle();
  }, [appearance]);

  const commitEdit = (node: MindNode, command: Parameters<typeof applyHeadingEdit>[1]) => {
    if (!activePath || !node.payload) return;
    setContent(applyHeadingEdit(content, command));
  };

  const renameNode = (node: MindNode, text: string) => {
    if (!node.payload) return;
    commitEdit(node, { kind: "rename", line: node.payload.line, text });
  };

  // Context menu state for a node.
  const [menu, setMenu] = useState<{ x: number; y: number; node: MindNode } | null>(null);
  // Rename dialog state.
  const [renameTarget, setRenameTarget] = useState<MindNode | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Delete confirm state.
  const [deleteTarget, setDeleteTarget] = useState<MindNode | null>(null);

  const openRename = (node: MindNode) => {
    setRenameTarget(node);
    setRenameValue(node.content);
  };
  const submitRename = () => {
    if (!renameTarget) return;
    renameNode(renameTarget, renameValue);
    setRenameTarget(null);
  };

  // Markmap nodes live inside an `<svg>`; foreignObject intercepts pointer
  // events (it calls stopPropagation on dblclick), so we listen in the capture
  // phase on the stage. Each heading node is a `g.markmap-node` element whose
  // datum (the node tree object with `payload.line`) is exposed as `__data__`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const g = target?.closest?.("g") ?? null;
      if (!isMindNodeGroup(g)) return;
      const d = (g as unknown as { __data__?: MindNode }).__data__;
      if (d && d.payload) openRename(d);
    };
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const g = target?.closest?.("g") ?? null;
      if (!isMindNodeGroup(g)) return;
      const d = (g as unknown as { __data__?: MindNode }).__data__;
      if (!d || !d.payload) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu({ x: event.clientX, y: event.clientY, node: d });
    };
    host.addEventListener("dblclick", onDoubleClick, true);
    host.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      host.removeEventListener("dblclick", onDoubleClick, true);
      host.removeEventListener("contextmenu", onContextMenu, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, content]);

  const fit = () => void markmapRef.current?.fit(1.6);
  const doExport = (format: "png" | "svg") => {
    const host = hostRef.current;
    if (!host) return;
    void exportMindmap(host, format);
  };
  const reset = () => {
    const mm = markmapRef.current;
    if (!mm) return;
    void rerender(mm, 1);
  };
  const expandAll = () => {
    const mm = markmapRef.current;
    if (!mm) return;
    void rerender(mm, 99);
  };

  return (
    <section
      aria-label={t("mindmap.label")}
      className={cn(
        "memoir-panel-in flex h-full min-h-0 min-w-0 flex-col bg-canvas",
        className,
      )}
    >
      <header
        className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1.5"
        data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
      >
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold tracking-[-0.02em] text-text">
            {t("mindmap.label")}
          </h2>
          <p className="truncate text-[11px] text-muted">
            {activeNote ? activeNote.title || activeNote.fileName : t("mindmap.emptyHint")}
          </p>
        </div>
        {activePath && (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <IconButton label={t("mindmap.exportPng")} onClick={() => void doExport("png")}>
              <ImageDown className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("mindmap.exportSvg")} onClick={() => void doExport("svg")}>
              <Download className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("mindmap.expandAll")} onClick={expandAll}>
              <UnfoldHorizontal className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("mindmap.fit")} onClick={fit}>
              <Maximize2 className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("mindmap.reset")} onClick={reset}>
              <RotateCcw className="h-4 w-4" />
            </IconButton>
          </div>
        )}
      </header>
      <div className="mindmap-stage relative min-h-0 flex-1 overflow-hidden">
        <svg
          aria-label={t("mindmap.label")}
          className="mindmap-stage-svg h-full w-full"
          ref={hostRef}
          role="img"
        />
        {!activePath ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
            <div className="max-w-xs text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" strokeWidth={1.4} aria-hidden />
              <p className="text-[13px] leading-6 text-muted">{t("mindmap.noNote")}</p>
            </div>
          </div>
        ) : headings.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
            <div className="max-w-xs text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" strokeWidth={1.4} aria-hidden />
              <p className="text-[13px] leading-6 text-muted">{t("mindmap.noHeadings")}</p>
            </div>
          </div>
        ) : (
          <div className="mindmap-hint absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-elevated px-3 py-1 text-[11px] text-muted shadow-sm">
            {t("mindmap.hint")}
          </div>
        )}
      </div>

      <ContextMenu
        label={t("mindmap.label")}
        onClose={() => setMenu(null)}
        open={Boolean(menu)}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
      >
        <ContextMenuItem
          icon={<Pencil />}
          label={t("mindmap.rename")}
          onSelect={() => menu && openRename(menu.node)}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<ChevronRight />}
          label={t("mindmap.indent")}
          onSelect={() => menu && commitEdit(menu.node, { kind: "indent", line: menu.node.payload!.line })}
        />
        <ContextMenuItem
          icon={<ChevronLeft />}
          label={t("mindmap.outdent")}
          onSelect={() => menu && commitEdit(menu.node, { kind: "outdent", line: menu.node.payload!.line })}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          danger
          icon={<Trash2 />}
          label={t("mindmap.delete")}
          onSelect={() => menu && setDeleteTarget(menu.node)}
        />
      </ContextMenu>

      <Dialog
        footer={
          <>
            <Button onClick={() => setRenameTarget(null)}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary">
              {t("common.rename")}
            </Button>
          </>
        }
        onClose={() => setRenameTarget(null)}
        onSubmit={submitRename}
        open={Boolean(renameTarget)}
        title={t("mindmap.renamePrompt")}
      >
        <label className="memoir-field-label">
          {t("mindmap.label")}
          <Input
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            value={renameValue}
          />
        </label>
      </Dialog>

      <AlertDialog
        confirmLabel={t("common.delete")}
        description={t("mindmap.deleteConfirm", { title: deleteTarget?.content ?? "" })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget?.payload) {
            commitEdit(deleteTarget, { kind: "delete", line: deleteTarget.payload.line });
          }
        }}
        open={Boolean(deleteTarget)}
        title={t("mindmap.delete")}
      />
    </section>
  );
}