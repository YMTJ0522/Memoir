import { Check } from "lucide-react";
import { type ReactNode } from "react";
import { Kbd, cn } from "../../components/ui";

/**
 * Menu row for toolbar dropdowns. Mirrors ContextMenuItem markup
 * (.memoir-context-menu-item) so styling and keyboard focus work the same.
 * `combo` renders trailing keyboard hint keys; `separatorBefore` draws a
 * hairline above the row (inkstone-style dropdown grouping).
 */
export function ToolbarMenuItem({
  label,
  icon,
  checked,
  combo,
  separatorBefore,
  onSelect,
}: {
  label: string;
  icon?: ReactNode;
  checked?: boolean;
  /** Shortcut combo rendered as trailing Kbd keys (e.g. "mod+shift+h"). */
  combo?: string;
  /** Draws a separator line above this row. */
  separatorBefore?: boolean;
  onSelect: () => void;
}) {
  // inkstone parity: rows without an icon (or without a visible check mark)
  // render no leading icon column, so labels hug the menu edge.
  const hasLeading = icon !== undefined || checked === true;
  return (
    <>
      {separatorBefore && (
        <div aria-hidden="true" className="memoir-context-menu-separator" role="separator" />
      )}
      <button
        aria-checked={checked}
        className={cn(
          "memoir-context-menu-item",
          checked && "is-checked",
          !hasLeading && "memoir-context-menu-item--plain",
        )}
        onClick={(event) => {
          event.preventDefault();
          onSelect();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        role={checked === undefined ? "menuitem" : "menuitemradio"}
        type="button"
      >
        {hasLeading && (
          <span className="memoir-context-menu-icon" aria-hidden="true">
            {checked ? <Check /> : icon}
          </span>
        )}
        <span className="min-w-0 truncate">{label}</span>
        {combo && (
          <span className="toolbar-menu-combo" aria-hidden="true">
            <Kbd combo={combo} />
          </span>
        )}
      </button>
    </>
  );
}
