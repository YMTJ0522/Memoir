import {
  ChevronLeft,
  ChevronRight,
  ImageDown,
  Download,
  Maximize2,
  Sparkles,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton, cn } from "../../components/ui";
import { useI18n } from "../../i18n/react";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { renderMermaidDiagram } from "../preview/mermaid-runtime";
import { extractMermaidBlocks, mermaidBlockLabel } from "./flowchart-utils";
import { exportFlowchart } from "./export-flowchart";

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const FIT_PADDING = 64;

type Viewport = { x: number; y: number; scale: number };

/** Fit the rendered diagram into the stage (with padding), centered. */
function fitViewport(host: HTMLElement): Viewport {
  const diagram = host.querySelector<SVGSVGElement>(".flowchart-diagram");
  const stage = host.querySelector<HTMLElement>(".flowchart-stage");
  if (!diagram || !stage) return { x: 0, y: 0, scale: 1 };
  const box = diagram.getBoundingClientRect();
  const area = stage.getBoundingClientRect();
  const contentWidth = box.width || 1;
  const contentHeight = box.height || 1;
  const scale = Math.min(
    (area.width - FIT_PADDING) / contentWidth,
    (area.height - FIT_PADDING) / contentHeight,
    MAX_SCALE,
  );
  const clamped = Math.max(MIN_SCALE, scale);
  return {
    x: (area.width - contentWidth * clamped) / 2,
    y: (area.height - contentHeight * clamped) / 2,
    scale: clamped,
  };
}

export default function FlowchartView({ className }: { className?: string }) {
  const activePath = useAppStore((state) => state.activePath);
  const content = useAppStore((state) => state.content);
  const notes = useAppStore((state) => state.notes);
  const { t } = useI18n();

  const activeNote = notes.find((note) => note.relativePath === activePath) || null;
  const blocks = useMemo(
    () => (activePath ? extractMermaidBlocks(content) : []),
    [activePath, content],
  );

  const [selected, setSelected] = useState(0);
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });

  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Keep the selected index within bounds as blocks are added/removed.
  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, blocks.length - 1)));
  }, [blocks.length]);

  const block = blocks[selected] ?? null;

  // Render the selected block whenever it changes; theme changes re-render
  // via the cache key inside mermaid-runtime (light/dark SVG variants).
  useEffect(() => {
    if (!block) {
      setSvg("");
      setRenderError("");
      return;
    }
    let cancelled = false;
    void renderMermaidDiagram(block.code)
      .then((next) => {
        if (!cancelled) {
          setSvg(next);
          setRenderError("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSvg("");
          setRenderError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block?.code]);

  // Re-fit when a new diagram finishes rendering (double rAF so the layout
  // is committed before measuring), or when the stage resizes.
  useEffect(() => {
    if (!svg) return;
    const stage = stageRef.current;
    if (!stage) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      setViewport(fitViewport(stage));
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(fit));
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    observer?.observe(stage);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [svg]);

  const zoom = (direction: 1 | -1) => {
    setViewport((current) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale + direction * 0.15));
      // Zoom around the stage center so the view stays anchored.
      const stage = stageRef.current;
      if (!stage) return { ...current, scale: next };
      const rect = stage.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const ratio = next / current.scale;
      return {
        scale: next,
        x: cx - (cx - current.x) * ratio,
        y: cy - (cy - current.y) * ratio,
      };
    });
  };

  const resetFit = () => {
    const stage = stageRef.current;
    if (stage) setViewport(fitViewport(stage));
  };

  // Wheel zoom (ctrl/⌘ or plain wheel) and drag-to-pan handlers.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        // Plain wheel pans vertically; with shift, horizontally.
        event.preventDefault();
        setViewport((current) => ({
          ...current,
          y: current.y - event.deltaY,
          x: current.x - (event.shiftKey ? event.deltaX : 0),
        }));
        return;
      }
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewport((current) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
        const rect = stage.getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const ratio = next / current.scale;
        return {
          scale: next,
          x: cx - (cx - current.x) * ratio,
          y: cy - (cy - current.y) * ratio,
        };
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      // Only pan from the empty stage or from the diagram surface itself.
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest(".flowchart-toolbar, .flowchart-diagram-switcher")) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const start = viewportRef.current;
      stage.setPointerCapture(event.pointerId);
      const onMove = (moveEvent: PointerEvent) => {
        setViewport({
          scale: start.scale,
          x: start.x + (moveEvent.clientX - startX),
          y: start.y + (moveEvent.clientY - startY),
        });
      };
      const onUp = () => {
        stage.removeEventListener("pointermove", onMove);
        stage.removeEventListener("pointerup", onUp);
      };
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerup", onUp);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onPointerDown);
    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  const doExport = (format: "png" | "svg") => {
    const host = stageRef.current?.querySelector<SVGSVGElement>(".flowchart-diagram");
    if (!host) return;
    void exportFlowchart(host, format);
  };

  return (
    <section
      aria-label={t("flowchart.label")}
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
            {t("flowchart.label")}
          </h2>
          <p className="truncate text-[11px] text-muted">
            {activeNote ? activeNote.title || activeNote.fileName : t("flowchart.emptyHint")}
          </p>
        </div>
        {activePath && blocks.length > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <IconButton label={t("flowchart.exportPng")} onClick={() => doExport("png")}>
              <ImageDown className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("flowchart.exportSvg")} onClick={() => doExport("svg")}>
              <Download className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("flowchart.zoomIn")} onClick={() => zoom(1)}>
              <ZoomIn className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("flowchart.zoomOut")} onClick={() => zoom(-1)}>
              <ZoomOut className="h-4 w-4" />
            </IconButton>
            <IconButton label={t("flowchart.fit")} onClick={resetFit}>
              <Maximize2 className="h-4 w-4" />
            </IconButton>
          </div>
        )}
      </header>

      {blocks.length > 1 && (
        <div className="flowchart-diagram-switcher flex shrink-0 items-center justify-center gap-1 border-b border-border bg-panel px-4 py-1.5">
          <IconButton
            disabled={selected === 0}
            label={t("flowchart.prevDiagram")}
            onClick={() => setSelected((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <span className="tabular-nums text-[11px] text-muted" data-testid="flowchart-position">
            {selected + 1} / {blocks.length}
          </span>
          <IconButton
            disabled={selected === blocks.length - 1}
            label={t("flowchart.nextDiagram")}
            onClick={() =>
              setSelected((current) => Math.min(blocks.length - 1, current + 1))
            }
          >
            <ChevronRight className="h-4 w-4" />
          </IconButton>
          <span
            className="ml-2 max-w-[280px] truncate text-[11px] text-muted"
            title={block ? mermaidBlockLabel(block) : ""}
          >
            {block ? mermaidBlockLabel(block) : ""}
          </span>
        </div>
      )}

      <div className="flowchart-stage relative min-h-0 flex-1 overflow-hidden" ref={stageRef}>
        {!activePath ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
            <div className="max-w-xs text-center">
              <Waypoints className="mx-auto mb-3 h-8 w-8 text-muted" strokeWidth={1.4} aria-hidden />
              <p className="text-[13px] leading-6 text-muted">{t("flowchart.noNote")}</p>
            </div>
          </div>
        ) : blocks.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
            <div className="max-w-xs text-center">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" strokeWidth={1.4} aria-hidden />
              <p className="text-[13px] leading-6 text-muted">{t("flowchart.noDiagrams")}</p>
            </div>
          </div>
        ) : renderError ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
            <div className="w-full max-w-md">
              <pre className="overflow-auto rounded-lg border border-danger/30 bg-danger/5 p-4 text-left text-[12px] leading-5 text-danger whitespace-pre-wrap">
                {renderError}
              </pre>
            </div>
          </div>
        ) : (
          <div
            className="flowchart-canvas absolute inset-0"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <div
              className="flowchart-diagram max-w-none"
              data-mermaid-pending={svg ? undefined : ""}
              dangerouslySetInnerHTML={{ __html: svg || "" }}
            />
          </div>
        )}
        {activePath && blocks.length > 0 && !renderError && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-elevated px-3 py-1 text-[11px] text-muted shadow-sm">
            {t("flowchart.hint")}
          </div>
        )}
      </div>
    </section>
  );
}