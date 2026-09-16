import { useLayoutEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { createPortal } from "react-dom";
import { Sparkles, Heading1, Heading2, Heading3, Bold, Italic, List, ListOrdered, CheckSquare, Code2, Table, Quote, Minus } from "lucide-react";
import type { MessageKey } from "../../i18n/translate";
import { useI18n } from "../../i18n/react";
import { cn } from "../../components/ui";
import {
  filterSlashCommands,
  type SlashMenuRenderState,
} from "./slash-commands";

/** Maps command id → lucide icon for visual distinction. */
const COMMAND_ICONS: Record<string, React.ReactNode> = {
  heading1: <Heading1 className="h-3.5 w-3.5" />,
  heading2: <Heading2 className="h-3.5 w-3.5" />,
  heading3: <Heading3 className="h-3.5 w-3.5" />,
  bold: <Bold className="h-3.5 w-3.5" />,
  italic: <Italic className="h-3.5 w-3.5" />,
  bulletList: <List className="h-3.5 w-3.5" />,
  numberedList: <ListOrdered className="h-3.5 w-3.5" />,
  taskList: <CheckSquare className="h-3.5 w-3.5" />,
  codeBlock: <Code2 className="h-3.5 w-3.5" />,
  table: <Table className="h-3.5 w-3.5" />,
  quote: <Quote className="h-3.5 w-3.5" />,
  divider: <Minus className="h-3.5 w-3.5" />,
};

export function SlashMenu({
  view,
  state,
  onSelect,
}: {
  view: EditorView | null;
  state: SlashMenuRenderState | null;
  onSelect: (commandId: string) => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);

  const items = state ? filterSlashCommands(state.filter) : [];

  // Scroll the selected item into view inside the menu.
  useLayoutEffect(() => {
    if (!state || !menuRef.current) return;
    const el = menuRef.current.querySelector<HTMLElement>("[data-active='true']");
    el?.scrollIntoView({ block: "nearest" });
  }, [state?.selectedIndex, state?.filter]);

  if (!state || !view || items.length === 0) return null;

  // Position below the cursor, clamped to the window.
  const menuWidth = 220;
  const menuHeight = Math.min(360, items.length * 32 + 56);
  let left = state.x;
  let top = state.y + 6;
  if (left + menuWidth > window.innerWidth - 8) {
    left = window.innerWidth - menuWidth - 8;
  }
  if (top + menuHeight > window.innerHeight - 8) {
    top = state.y - menuHeight - 6;
  }
  left = Math.max(8, left);
  top = Math.max(8, top);

  let runningIndex = -1;
  const groups: Array<{ key: string; label: string; items: typeof items }> = [];
  const formatting = items.filter((i) => i.group === "formatting");
  const ai = items.filter((i) => i.group === "ai");
  if (formatting.length) groups.push({ key: "formatting", label: t("slash.formatting" as MessageKey), items: formatting });
  if (ai.length) groups.push({ key: "ai", label: t("slash.aiCommands" as MessageKey), items: ai });

  return createPortal(
    <div
      ref={menuRef}
      className="z-50 overflow-y-auto rounded-lg border border-border bg-elevated py-1 shadow-lg"
      style={{ left, top, width: menuWidth, maxHeight: menuHeight }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      role="menu"
    >
      {groups.map((group) => (
        <div key={group.key} role="group">
          <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
            {group.label}
          </div>
          {group.items.map((item) => {
            runningIndex += 1;
            const index = runningIndex;
            const active = index === state.selectedIndex;
            const isAi = item.group === "ai";
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-active={active}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] cursor-pointer transition-colors",
                  active ? "bg-surface" : "hover:bg-surface/60",
                )}
                onMouseEnter={() => {
                  // Hover does not re-trigger keyboard navigation; just visual.
                }}
                onClick={() => onSelect(item.id)}
              >
                <span className="flex h-4 w-4 items-center justify-center text-muted">
                  {isAi ? (
                    <Sparkles className="h-3.5 w-3.5" />
                  ) : (
                    COMMAND_ICONS[item.id] ?? <Minus className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="truncate">{t(item.labelKey as MessageKey)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}
