import { FileText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Input, cn } from "../../components/ui";
import { useI18n } from "../../i18n/react";
import type { WikiCatalogNote } from "./wiki-links";
import { wikiInsertToken } from "./wiki-links";

/**
 * Note picker dialog behind the toolbar "note syntax" menu. Instead of
 * inserting an empty `[[ ]]` / `![[ ]]` token, the picker lets the user
 * choose a note up front (mirrors the image-picker flow of the image
 * button). Emits the ready-to-paste token via `onInsert`.
 */
export function NotePickerDialog({
  catalog,
  embed,
  onClose,
  onInsert,
  open,
}: {
  catalog: WikiCatalogNote[];
  embed: boolean;
  onClose: () => void;
  onInsert: (token: string) => void;
  open: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((note) => {
      if (note.title.toLowerCase().includes(needle)) return true;
      const path = note.relativePath.toLowerCase();
      return path.includes(needle);
    });
  }, [catalog, query]);

  useEffect(() => {
    setActiveIndex((current) =>
      filtered.length ? Math.min(current, filtered.length - 1) : 0,
    );
  }, [filtered.length]);

  const insert = (note: WikiCatalogNote) => {
    onInsert(`${embed ? "!" : ""}[[${wikiInsertToken(note, catalog, query)}]]`);
    onClose();
  };

  const listId = "memoir-note-picker-list";
  return (
    <Dialog
      className="max-w-[420px]"
      description={t("toolbar.pickerDescription")}
      onClose={onClose}
      open={open}
      title={embed ? t("toolbar.noteEmbed") : t("toolbar.wikiLink")}
    >
      <label className="note-search relative mb-2 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <Input
          aria-label={t("toolbar.pickerSearch")}
          className="h-8 rounded-[10px] pl-8 shadow-none"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => (filtered.length ? (current + 1) % filtered.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) =>
                filtered.length ? (current - 1 + filtered.length) % filtered.length : 0,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              const note = filtered[activeIndex];
              if (note) insert(note);
            }
          }}
          placeholder={t("toolbar.pickerSearch")}
          role="combobox"
          type="search"
          value={query}
          aria-controls={listId}
          aria-expanded
        />
      </label>
      <div className="flex max-h-[320px] min-h-[120px] flex-col gap-0.5 overflow-auto" id={listId} role="listbox">
        {filtered.map((note, index) => (
          <button
            aria-selected={index === activeIndex}
            className={cn(
              "memoir-note-picker-option flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left",
              index === activeIndex && "is-active",
            )}
            key={note.relativePath}
            onClick={() => insert(note)}
            onPointerMove={() => setActiveIndex(index)}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <FileText aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold text-text">
                {note.title || note.relativePath}
              </span>
              <span className="block truncate text-[10px] text-muted">{note.relativePath}</span>
            </span>
          </button>
        ))}
        {!filtered.length && (
          <p className="grid min-h-[120px] place-items-center text-[12px] text-muted">
            {t("toolbar.pickerEmpty")}
          </p>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={onClose} variant="ghost">
          {t("common.cancel")}
        </Button>
      </div>
    </Dialog>
  );
}

/** URL prompt dialog for the "remote image" menu item. */
export function RemoteImageDialog({
  onClose,
  onInsert,
  open,
}: {
  onClose: () => void;
  onInsert: (url: string) => void;
  open: boolean;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl("https://");
      setDirty(false);
    }
  }, [open]);

  const trimmed = url.trim();
  const valid = /^https?:\/\/\S+$/.test(trimmed);
  return (
    <Dialog
      className="max-w-[420px]"
      description={t("toolbar.remoteImageDescription")}
      onClose={onClose}
      onSubmit={() => {
        if (!valid) return;
        onInsert(trimmed);
        onClose();
      }}
      open={open}
      title={t("toolbar.remoteImage")}
    >
      <Input
        aria-label={t("toolbar.remoteImageUrl")}
        inputMode="url"
        onChange={(event) => {
          setUrl(event.target.value);
          setDirty(true);
        }}
        placeholder="https://example.com/image.png"
        type="url"
        value={url}
      />
      {dirty && trimmed !== "" && !valid && (
        <p className="mt-1.5 text-[11px] text-danger" role="alert">
          {t("toolbar.remoteImageInvalid")}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-1.5">
        <Button onClick={onClose} variant="ghost">
          {t("common.cancel")}
        </Button>
        <Button disabled={!valid} type="submit">
          {t("common.insert")}
        </Button>
      </div>
    </Dialog>
  );
}

export type NoteSyntaxDialogState =
  | { kind: "notePicker"; embed: boolean }
  | { kind: "remoteImage" }
  | null;

