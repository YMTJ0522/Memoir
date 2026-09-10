import { FileText, Image as ImageIcon, Paperclip, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, cn } from "../../components/ui";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { formatRelativeTime } from "../../i18n";
import type { TrashEntry } from "../../domain/trash";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);

function TrashItemGlyph({ entry }: { entry: TrashEntry }) {
  if (entry.isAttachment) {
    const extension = entry.originalPath.split(".").pop()?.toLowerCase() ?? "";
    if (IMAGE_EXTENSIONS.has(extension)) {
      return <ImageIcon className="h-3.5 w-3.5 text-accent" />;
    }
    return <Paperclip className="h-3.5 w-3.5 text-accent" />;
  }
  return <FileText className="h-3.5 w-3.5 text-accent" />;
}

function formatTrashSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function trashDisplayName(entry: TrashEntry) {
  const name = entry.originalPath.split("/").pop() || entry.originalPath;
  if (entry.isAttachment) return name;
  return name.replace(/\.(md|mdx)$/i, "") || name;
}

export function TrashPanel() {
  const trash = useAppStore((state) => state.trash);
  const restoreTrashItem = useAppStore((state) => state.restoreTrashItem);
  const purgeTrashItem = useAppStore((state) => state.purgeTrashItem);
  const emptyTrash = useAppStore((state) => state.emptyTrash);
  const { t, locale } = useI18n();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(null);
      setConfirmEmpty(false);
      setConfirmPurge(null);
    }
  };

  return (
    <div className="relative memoir-panel-in flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-3 text-[11px] font-medium text-muted">
        <span>{t("trash.count", { count: trash.length })}</span>
        {trash.length > 0 && (
          <Button
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setConfirmEmpty(true)}
            variant="ghost"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("trash.empty")}
          </Button>
        )}
      </div>

      {trash.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-muted">{t("trash.emptyHint")}</p>
      ) : (
        <div className="note-list-scroll memoir-stagger grid flex-1 content-start gap-1.5 overflow-auto px-2.5 pb-3">
          {trash.map((entry) => {
            const displayName = trashDisplayName(entry);
            const busyThis = busy === entry.trashName;
            return (
              <div
                className="trash-entry rounded-lg border border-border bg-surface px-3 py-2.5"
                key={entry.trashName}
              >
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                  <TrashItemGlyph entry={entry} />
                  <div className="min-w-0">
                    <h3 className="truncate text-[13px] font-semibold text-text">{displayName}</h3>
                    <p className="truncate text-[10px] text-muted">{entry.originalPath}</p>
                  </div>
                  {entry.isAttachment ? (
                    <span className="rounded bg-panel px-1.5 py-0.5 text-[9px] font-medium text-muted">
                      {t("trash.attachment")}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted">
                    <span title={new Date(entry.deletedAtMs).toLocaleString()}>
                      {formatRelativeTime(entry.deletedAtMs, locale)}
                    </span>
                    <span className="tabular-nums">{formatTrashSize(entry.size)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {confirmPurge === entry.trashName ? (
                      <>
                        <Button
                          className="h-7 gap-1 px-2 text-[11px]"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(entry.trashName, () => purgeTrashItem(entry.trashName))
                          }
                          variant="danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("trash.purgeConfirm")}
                        </Button>
                        <IconButton
                          label={t("common.cancel")}
                          className="h-7 w-7"
                          disabled={busy !== null}
                          onClick={() => setConfirmPurge(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        <IconButton
                          label={t("trash.purge")}
                          className="h-7 w-7 text-muted"
                          disabled={busy !== null}
                          onClick={() => setConfirmPurge(entry.trashName)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton
                          label={t("trash.restore")}
                          className="h-7 w-7"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(entry.trashName, () => restoreTrashItem(entry.trashName))
                          }
                        >
                          <RotateCcw className={cn("h-3.5 w-3.5", busyThis && "animate-spin")} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmEmpty && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/60 p-4">
          <div className="w-full max-w-xs rounded-xl border border-border bg-panel p-4 shadow-lg">
            <h3 className="text-[13px] font-semibold text-text">{t("trash.emptyTitle")}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{t("trash.emptyConfirm")}</p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                className="h-8 px-3 text-[12px]"
                disabled={busy !== null}
                onClick={() => setConfirmEmpty(false)}
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                className="h-8 gap-1.5 px-3 text-[12px]"
                disabled={busy !== null}
                onClick={() => void run("__empty__", () => emptyTrash())}
                variant="danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("trash.empty")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}