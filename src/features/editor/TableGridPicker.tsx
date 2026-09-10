import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton, cn } from "../../components/ui";
import { useI18n } from "../../i18n/react";

/** Hover-open delay so pointer sweeps across the button do not pop the grid. */
const OPEN_DELAY_MS = 120;
/** Close delay covering the gap between the button and the portaled grid. */
const CLOSE_DELAY_MS = 180;
const GRID_SIZE = 8;
const CELL_STEP = 18;

/**
 * Toolbar table button with an 8×8 size picker: hovering the button opens
 * the grid, sliding the pointer paints rows × cols, clicking a cell inserts
 * a table of that size. The grid is portaled with position:fixed so it is
 * never clipped by the toolbar's overflow-x-auto.
 */
export function TableGridPicker({
  label,
  icon,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  onPick: (rows: number, cols: number) => void;
}) {
  const { t } = useI18n();
  const holderRef = useRef<HTMLSpanElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number>(0);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [hover, setHover] = useState({ rows: 0, cols: 0 });

  const openGrid = () => {
    window.clearTimeout(timerRef.current);
    const rect = holderRef.current?.getBoundingClientRect();
    if (rect) setPosition({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  };
  /** Click path: also focus the first cell so keyboard users can navigate. */
  const openGridAndFocus = () => {
    openGrid();
    window.requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(".toolbar-grid-cell")?.focus();
    });
  };
  const scheduleClose = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpen(false);
      setHover({ rows: 0, cols: 0 });
    }, CLOSE_DELAY_MS);
  };
  const closeNow = () => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
    setHover({ rows: 0, cols: 0 });
  };

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (gridRef.current?.contains(target)) return;
      if (holderRef.current?.contains(target)) return;
      closeNow();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNow();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (typeof document === "undefined") {
    return (
      <span ref={holderRef}>
        <IconButton className="format-button" label={label} title="">
          {icon}
        </IconButton>
      </span>
    );
  }

  return (
    <span
      onBlur={scheduleClose}
      onFocus={openGrid}
      onMouseEnter={() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(openGrid, OPEN_DELAY_MS);
      }}
      onMouseLeave={scheduleClose}
      ref={holderRef}
    >
      <IconButton
        aria-expanded={open}
        aria-haspopup="dialog"
        className="format-button"
        label={label}
        onClick={openGridAndFocus}
        title=""
      >
        {icon}
      </IconButton>
      {open &&
        createPortal(
          <div
            className="memoir-context-menu is-open toolbar-grid-picker"
            onFocus={() => window.clearTimeout(timerRef.current)}
            onMouseEnter={() => window.clearTimeout(timerRef.current)}
            onMouseLeave={scheduleClose}
            ref={gridRef}
            role="dialog"
            aria-label={label}
            style={{ left: position.left, top: position.top }}
          >
            <div
              className="toolbar-grid"
              onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
              role="grid"
              style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_STEP}px)` }}
            >
              {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
                const row = Math.floor(index / GRID_SIZE) + 1;
                const col = (index % GRID_SIZE) + 1;
                const active = row <= hover.rows && col <= hover.cols;
                return (
                  <button
                    aria-label={t("toolbar.tableSize", { rows: row, cols: col })}
                    className={cn("toolbar-grid-cell", active && "is-active")}
                    key={index}
                    onClick={() => {
                      onPick(row, col);
                      closeNow();
                    }}
                    onMouseEnter={() => setHover({ rows: row, cols: col })}
                    role="gridcell"
                    type="button"
                  />
                );
              })}
            </div>
            <p className="toolbar-grid-label">
              {hover.rows
                ? t("toolbar.tableSize", { rows: hover.rows, cols: hover.cols })
                : t("toolbar.tableSizeHint")}
            </p>
          </div>,
          document.body,
        )}
    </span>
  );
}
