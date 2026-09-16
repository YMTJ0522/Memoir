import {
  FilePlus2,
  Moon,
  PanelLeft,
  Save,
  Settings,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { Input } from "../../components/ui";
import { cn } from "../../components/ui/cn";
import { usePresence } from "../../components/ui/usePresence";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";

type CommandId =
  | "newNote"
  | "toggleTheme"
  | "openSettings"
  | "saveNote"
  | "toggleSidebar";

type CommandDef = {
  id: CommandId;
  labelKey:
    | "palette.command.newNote"
    | "palette.command.toggleTheme"
    | "palette.command.openSettings"
    | "palette.command.saveNote"
    | "palette.command.toggleSidebar";
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  run: () => void;
};

type FlatItem =
  | { kind: "command"; command: CommandDef }
  | { kind: "note"; relativePath: string; title: string };

export function CommandPalette({
  open,
  onClose,
  mode = "command",
}: {
  open: boolean;
  onClose: () => void;
  mode?: "command" | "quickOpen";
}) {
  const { t } = useI18n();
  const { present, visible } = usePresence(open);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isQuickOpen = mode === "quickOpen";

  // Reset query and selection whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus the input on the next tick so it lands after mount.
      const id = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [open]);

  // Build the command list (only in command mode).
  const commands = useMemo<CommandDef[]>(() => {
    if (isQuickOpen) return [];
    const state = useAppStore.getState();
    const currentTheme = state.settings.appearance.theme;
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    return [
      {
        id: "newNote",
        labelKey: "palette.command.newNote",
        icon: FilePlus2,
        run: () => {
          void useAppStore.getState().createNote({
            title: "未命名",
            extension: "md",
          });
        },
      },
      {
        id: "toggleTheme",
        labelKey: "palette.command.toggleTheme",
        icon: currentTheme === "dark" ? Sun : Moon,
        run: () => {
          const s = useAppStore.getState();
          s.setSettings({ ...s.settings, appearance: { ...s.settings.appearance, theme: nextTheme } });
        },
      },
      {
        id: "openSettings",
        labelKey: "palette.command.openSettings",
        icon: Settings,
        run: () => {
          useAppStore.getState().openSettings();
        },
      },
      {
        id: "saveNote",
        labelKey: "palette.command.saveNote",
        icon: Save,
        run: () => {
          void useAppStore.getState().saveActiveNote();
        },
      },
      {
        id: "toggleSidebar",
        labelKey: "palette.command.toggleSidebar",
        icon: PanelLeft,
        run: () => {
          const s = useAppStore.getState();
          s.setSidebarCollapsed(!s.isSidebarCollapsed);
        },
      },
    ];
  }, [isQuickOpen]);

  // Filtered commands by query.
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => t(cmd.labelKey).toLowerCase().includes(q));
  }, [commands, query, t]);

  // Filtered notes by title fuzzy match.
  const filteredNotes = useMemo(() => {
    const allNotes = useAppStore.getState().notes;
    const q = query.trim().toLowerCase();
    if (!q) return allNotes;
    return allNotes.filter((note) => note.title.toLowerCase().includes(q));
  }, [query]);

  // Flatten commands + notes into a single navigable list.
  const flatItems = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [
      ...filteredCommands.map((command) => ({ kind: "command" as const, command })),
      ...filteredNotes.map((note) => ({
        kind: "note" as const,
        relativePath: note.relativePath,
        title: note.title,
      })),
    ];
    return items;
  }, [filteredCommands, filteredNotes]);

  // Clamp selectedIndex when the list changes.
  useEffect(() => {
    if (selectedIndex > flatItems.length - 1) {
      setSelectedIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, selectedIndex]);

  // Scroll the selected item into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeItem = (item: FlatItem) => {
    if (item.kind === "command") {
      item.command.run();
    } else {
      void useAppStore.getState().selectNote(item.relativePath);
    }
    onClose();
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) executeItem(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  if (!present) return null;

  const placeholder = isQuickOpen
    ? t("palette.quickOpenPlaceholder")
    : t("palette.placeholder");

  let flatIndexCounter = -1;

  return createPortal(
    <div
      className={cn(
        "memoir-overlay fixed z-50 grid place-items-start bg-text/30 backdrop-blur-sm",
        visible && "is-open",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
      style={{ paddingTop: "15vh" }}
    >
      <div
        className={cn(
          "memoir-dialog w-full max-w-xl overflow-hidden rounded-xl shadow-2xl",
          visible && "is-open",
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-border px-3 pt-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder={placeholder}
            className="h-10 text-sm"
          />
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
          {flatItems.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted">
              {t("palette.noResults")}
            </div>
          )}

          {!isQuickOpen && filteredCommands.length > 0 && (
            <>
              <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t("palette.commands")}
              </div>
              {filteredCommands.map((command) => {
                flatIndexCounter += 1;
                const idx = flatIndexCounter;
                const Icon = command.icon;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={command.id}
                    data-index={idx}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-text transition-colors",
                      isSelected ? "bg-accent/10" : "hover:bg-canvas",
                    )}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => executeItem({ kind: "command", command })}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} />
                    <span className="truncate">{t(command.labelKey)}</span>
                  </button>
                );
              })}
            </>
          )}

          {filteredNotes.length > 0 && (
            <>
              <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t("palette.notes")}
              </div>
              {filteredNotes.map((note) => {
                flatIndexCounter += 1;
                const idx = flatIndexCounter;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={note.relativePath}
                    data-index={idx}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-text transition-colors",
                      isSelected ? "bg-accent/10" : "hover:bg-canvas",
                    )}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() =>
                      executeItem({
                        kind: "note",
                        relativePath: note.relativePath,
                        title: note.title,
                      })
                    }
                  >
                    <span className="truncate">{note.title}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
