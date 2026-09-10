import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { IconButton, cn } from "../../components/ui";

/**
 * Toolbar button opening a ContextMenu-styled dropdown. Rendered through a
 * portal with the shared .memoir-context-menu classes so it matches editor
 * right-click menus visually and behaviorally (keyboard nav included).
 * `onOpenChange` fires synchronously on every real open/close transition.
 */
export function ToolbarDropdownButton({
  label,
  icon,
  children,
  width = 176,
  align = "start",
  disabled = false,
  onOpenChange,
}: {
  label: string;
  icon: ReactNode;
  /** Menu items; call close() after an action. */
  children: (close: () => void) => ReactNode;
  width?: number;
  /** Horizontal anchoring: "start" aligns menu left edge with the button, "end" aligns right edges. */
  align?: "start" | "end";
  disabled?: boolean;
  /** Notifies the owner (e.g. to suppress the wrapping tooltip while open). */
  onOpenChange?: (open: boolean) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  // Open/close notify synchronously (no effect): an effect keyed on a fresh
  // inline onOpenChange identity would re-run for every sibling dropdown on
  // each parent render and clobber the owner's open-menu tracking.
  const openMenu = () => {
    if (disabled) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // Initial estimate from the declared width; useLayoutEffect re-anchors
      // to the real shrink-wrapped menu box once it has rendered.
      const menuWidth = Math.min(
        width,
        typeof window === "undefined" ? width : window.innerWidth - 16,
      );
      const left = align === "end" ? rect.right - menuWidth : rect.left;
      setPosition({ left: Math.max(8, left), top: rect.bottom + 4 });
    }
    const next = !open;
    setOpen(next);
    onOpenChange?.(next);
  };

  // Re-anchor after render: the menu shrink-wraps (width: max-content), so
  // for align="end" the pre-render estimate from the `width` prop leaves the
  // real menu far left of the button. Measuring the actual box also lets us
  // flip above the button and clamp inside the viewport (ContextMenu parity).
  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const btnRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const pad = 8;

    const left =
      align === "end"
        ? Math.max(pad, Math.min(btnRect.right - menuRect.width, window.innerWidth - menuRect.width - pad))
        : Math.max(pad, Math.min(btnRect.left, window.innerWidth - menuRect.width - pad));

    // Prefer below the button; flip above when the menu would overflow the
    // bottom edge and there is more room on top.
    const belowTop = btnRect.bottom + 4;
    const aboveTop = btnRect.top - menuRect.height - 4;
    const top =
      belowTop + menuRect.height > window.innerHeight - pad && aboveTop >= pad
        ? aboveTop
        : belowTop;

    setPosition({ left, top });
  }, [open, align, width]);

  const close = () => {
    if (!open) return;
    setOpen(false);
    onOpenChange?.(false);
  };

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const items = menu
      ? [
          ...menu.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
          ),
        ]
      : [];
    items[0]?.focus();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const next = current < 0 ? 0 : (current + offset + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return (
    <span className="inline-flex" ref={buttonRef}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        className="format-button"
        disabled={disabled}
        label={label}
        onClick={openMenu}
        title=""
      >
        <span className="toolbar-dropdown-face">
          {icon}
          <ChevronDown aria-hidden="true" className="toolbar-dropdown-chevron" />
        </span>
      </IconButton>
      {open &&
        createPortal(
          <div
            className={cn("memoir-context-menu is-open toolbar-dropdown-menu")}
            ref={menuRef}
            role="menu"
            style={{ left: position.left, top: position.top, maxWidth: width }}
          >
            <span className="sr-only">{label}</span>
            {children(close)}
          </div>,
          document.body,
        )}
    </span>
  );
}
