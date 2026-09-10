import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn";

/** Pretty keyboard part per platform (inkstone prettyCombo semantics). */
function prettyComboPart(part: string): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform || "");
  switch (part.toLowerCase()) {
    case "mod":
      return isMac ? "⌘" : "Ctrl";
    case "shift":
      return isMac ? "⇧" : "Shift";
    case "alt":
      return isMac ? "⌥" : "Alt";
    case "ctrl":
      return isMac ? "⌃" : "Ctrl";
    case "escape":
    case "esc":
      return "Esc";
    case "enter":
      return "↵";
    case "backspace":
      return isMac ? "⌫" : "Backspace";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    default:
      return part.length === 1 ? part.toUpperCase() : part;
  }
}

/** Single keyboard key cap. */
export function Kbd({ combo, keys }: { combo?: string; keys?: string[] }) {
  const parts = keys ?? (combo ? combo.split("+").map(prettyComboPart) : []);
  return (
    <span className="inline-flex shrink-0 items-center gap-[3px]">
      {parts.map((key, index) => (
        <kbd
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-[5px]",
            "border border-border bg-canvas",
            "text-[10.5px] font-medium text-muted",
          )}
          key={`${key}-${index}`}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipPosition {
  top: number;
  left: number;
  side: TooltipSide;
}

interface VisibleViewport {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Clamped viewport rect (visualViewport-aware), inkstone semantics. */
function getVisibleViewport(): VisibleViewport {
  const viewport =
    typeof window !== "undefined" && window.visualViewport
      ? window.visualViewport
      : null;
  const top = viewport?.offsetTop ?? 0;
  const left = viewport?.offsetLeft ?? 0;
  const width = viewport?.width ?? (typeof window !== "undefined" ? window.innerWidth : 0);
  const height = viewport?.height ?? (typeof window !== "undefined" ? window.innerHeight : 0);
  return { top, left, right: left + width, bottom: top + height };
}

function placeTooltip(
  anchor: DOMRect,
  tooltip: DOMRect,
  preferred: TooltipSide,
): TooltipPosition {
  const gap = 7;
  const padding = 8;
  const viewport = getVisibleViewport();
  let side = preferred;
  if (
    preferred === "bottom" &&
    anchor.bottom + gap + tooltip.height > viewport.bottom - padding &&
    (anchor.top - gap - tooltip.height >= viewport.top + padding ||
      anchor.top - viewport.top > viewport.bottom - anchor.bottom)
  ) {
    side = "top";
  } else if (
    preferred === "top" &&
    anchor.top - gap - tooltip.height < viewport.top + padding &&
    (anchor.bottom + gap + tooltip.height <= viewport.bottom - padding ||
      viewport.bottom - anchor.bottom > anchor.top - viewport.top)
  ) {
    side = "bottom";
  } else if (
    preferred === "right" &&
    anchor.right + gap + tooltip.width > viewport.right - padding &&
    (anchor.left - gap - tooltip.width >= viewport.left + padding ||
      anchor.left - viewport.left > viewport.right - anchor.right)
  ) {
    side = "left";
  } else if (
    preferred === "left" &&
    anchor.left - gap - tooltip.width < viewport.left + padding &&
    (anchor.right + gap + tooltip.width <= viewport.right - padding ||
      viewport.right - anchor.right > anchor.left - viewport.left)
  ) {
    side = "right";
  }
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));
  if (side === "top" || side === "bottom") {
    return {
      side,
      top: side === "bottom" ? anchor.bottom + gap : anchor.top - gap - tooltip.height,
      left: clamp(
        anchor.left + anchor.width / 2 - tooltip.width / 2,
        viewport.left + padding,
        viewport.right - tooltip.width - padding,
      ),
    };
  }
  return {
    side,
    top: clamp(
      anchor.top + anchor.height / 2 - tooltip.height / 2,
      viewport.top + padding,
      viewport.bottom - tooltip.height - padding,
    ),
    left: side === "right" ? anchor.right + gap : anchor.left - gap - tooltip.width,
  };
}

/**
 * Portal tooltip aligned with the inkstone reference implementation:
 * rendered into document.body with position:fixed so it never gets clipped
 * by scroll containers (e.g. the markdown toolbar's overflow-x-auto).
 * Shows on hover (fine pointers only) and :focus-visible, with a delay.
 * `suppress` keeps it hidden while e.g. an attached dropdown menu is open.
 */
export function Tooltip({
  label,
  combo,
  side = "bottom",
  delay = 420,
  suppress = false,
  children,
}: {
  label: ReactNode;
  combo?: string;
  children: ReactNode;
  side?: TooltipSide;
  delay?: number;
  suppress?: boolean;
}) {
  const holderRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number>(0);
  const suppressRef = useRef(suppress);
  suppressRef.current = suppress;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const measureAnchor = useCallback(() => {
    const anchor = holderRef.current?.firstElementChild;
    if (!(anchor instanceof Element)) return null;
    const next = anchor.getBoundingClientRect();
    return next.width || next.height ? next : null;
  }, []);

  const show = useCallback(() => {
    // While suppressed (attached menu open), entering the trigger must not
    // re-arm the timer: the tooltip would reappear over the menu.
    if (suppressRef.current) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (suppressRef.current) return;
      const next = measureAnchor();
      if (next) {
        setPosition(null);
        setRect(next);
      }
    }, delay);
  }, [delay, measureAnchor]);

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setPosition(null);
    setRect(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // While suppressed (menu open), drop any visible tooltip and stay hidden.
  useEffect(() => {
    if (suppress) {
      window.clearTimeout(timerRef.current);
      setPosition(null);
      setRect(null);
    }
  }, [suppress]);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!rect || !tooltip) return;
    setPosition(placeTooltip(rect, tooltip.getBoundingClientRect(), side));
  }, [combo, label, rect, side]);

  useEffect(() => {
    if (!rect) return;
    const update = () => {
      const next = measureAnchor();
      if (next) setRect(next);
      else {
        setPosition(null);
        setRect(null);
      }
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [measureAnchor, rect]);

  const style: React.CSSProperties = position
    ? { top: position.top, left: position.left, visibility: "visible" }
    : { top: 0, left: 0, visibility: "hidden" };

  if (typeof document === "undefined") return <>{children}</>;

  return (
    <>
      <span
        className="contents"
        onBlur={hide}
        onFocus={(event) => {
          if ((event.target as HTMLElement).matches(":focus-visible")) show();
        }}
        onMouseEnter={() => {
          if (
            typeof window.matchMedia !== "function" ||
            window.matchMedia("(hover: hover) and (pointer: fine)").matches
          )
            show();
        }}
        onMouseLeave={hide}
        ref={holderRef}
      >
        {children}
      </span>
      {rect &&
        createPortal(
          <div
            className="memoir-fade-in pointer-events-none fixed z-[500] flex max-w-[calc(100vw-16px)] items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-elevated px-2 py-1 text-[11.5px] text-muted shadow-lg"
            data-side={position?.side}
            ref={tooltipRef}
            role="tooltip"
            style={style}
          >
            {label}
            {combo && <Kbd combo={combo} />}
          </div>,
          document.body,
        )}
    </>
  );
}
