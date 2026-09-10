import { History, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getGateways } from "../../gateways";
import { formatBytes } from "../../domain/attachments";
import type { NoteVersionMeta } from "../../domain/notes";
import type { AppLocale } from "../../domain/settings";
import { dateLocale, resolveLocale } from "../../i18n/locale";
import { formatRelativeTime } from "../../i18n/format";
import { useI18n } from "../../i18n/react";
import type { MessageKey } from "../../i18n/translate";
import { useAppStore } from "../../store/app-store";
import { AlertDialog } from "../../components/ui/AlertDialog";
import { Button } from "../../components/ui";
import { Dialog } from "../../components/ui/Dialog";
import { cn } from "../../components/ui/cn";

export function VersionsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const activePath = useAppStore((state) => state.activePath);
  const content = useAppStore((state) => state.savedContent);
  const restoreNoteVersion = useAppStore((state) => state.restoreNoteVersion);
  const settings = useAppStore((state) => state.settings);
  const locale = resolveLocale(settings.appearance.locale);

  const [versions, setVersions] = useState<NoteVersionMeta[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsReload, setVersionsReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReload, setPreviewReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busyRef = useRef(false);
  const pathRef = useRef(activePath);
  const restoreEpoch = useRef(0);
  pathRef.current = activePath;

  useEffect(() => {
    restoreEpoch.current += 1;
    busyRef.current = false;
    setBusy(false);
    setVersions(null);
    setVersionsError(null);
    setSelectedId(null);
    setPreview(null);
    setPreviewError(null);
    if (!workspaceRoot || !activePath) return;
    let cancelled = false;
    getGateways()
      .persistence.listNoteVersions(workspaceRoot, activePath)
      .then((loaded) => {
        if (cancelled) return;
        setVersions(loaded);
        setSelectedId(loaded[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setVersionsError(t("versions.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, t, versionsReload, workspaceRoot]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!workspaceRoot || !activePath || !selectedId) return;
    let cancelled = false;
    getGateways()
      .persistence.getNoteVersion(workspaceRoot, activePath, selectedId)
      .then((version) => {
        if (!cancelled) setPreview(version.content);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(t("versions.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, selectedId, previewReload, t, workspaceRoot]);

  const diff = useMemo(
    () => (preview === null ? null : computeLineDiff(preview, content, t)),
    [content, preview, t],
  );

  const restore = async () => {
    if (!activePath || !selectedId || preview === null || previewError || busyRef.current) return;
    const restorePath = activePath;
    const versionId = selectedId;
    const epoch = ++restoreEpoch.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const ok = await new Promise<boolean>((resolve) => {
        pendingConfirmRef.current = resolve;
        setConfirmOpen(true);
      });
      if (!ok || restoreEpoch.current !== epoch || pathRef.current !== restorePath) return;
      await restoreNoteVersion(versionId);
      onClose();
    } finally {
      if (restoreEpoch.current === epoch && pathRef.current === restorePath) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const pendingConfirmRef = useRef<((value: boolean) => void) | null>(null);

  return (
    <>
      <Dialog
        className="max-w-[880px]"
        description={activePath ?? undefined}
        footer={
          <>
            <Button onClick={onClose}>{t("common.close")}</Button>
            <Button
              disabled={!selectedId || preview === null || Boolean(previewError) || busy}
              variant="primary"
              onClick={() => void restore()}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {busy ? t("versions.restoring") : t("versions.restore")}
            </Button>
          </>
        }
        onClose={onClose}
        open
        title={t("versions.title")}
      >
        {versionsError ? (
          <div className="grid h-40 place-items-center gap-2 text-sm text-muted">
            <span>{t("versions.loadFailed")}</span>
            <Button size="sm" variant="secondary" onClick={() => setVersionsReload((value) => value + 1)}>
              {t("library.indexRetry")}
            </Button>
          </div>
        ) : versions === null ? (
          <div className="grid h-40 place-items-center text-sm text-muted">
            {t("editor.loadingEditor")}
          </div>
        ) : versions.length === 0 ? (
          <div className="grid h-40 place-items-center text-sm text-muted">
            {t("versions.empty")}
          </div>
        ) : (
          <div className="flex h-[min(68dvh,560px)] min-h-0 flex-col gap-3 md:h-[440px] md:flex-row">
            <ul className="flex w-full shrink-0 gap-1 overflow-x-auto border-b border-border pb-2 md:block md:w-[210px] md:space-y-px md:overflow-y-auto md:border-r md:border-b-0 md:pr-2 md:pb-0">
              {versions.map((version, index) => (
                <li className="w-[188px] shrink-0 md:w-auto" key={version.id}>
                  <button
                    aria-pressed={selectedId === version.id}
                    className={cn(
                      "w-full rounded-md px-2 py-2 text-left transition-colors",
                      selectedId === version.id ? "bg-accent-soft" : "hover:bg-accent-soft/60",
                    )}
                    onClick={() => setSelectedId(version.id)}
                    type="button"
                  >
                    <div className="flex items-center gap-1.5 text-[12px] font-medium text-text">
                      <History className="h-[11px] w-[11px] shrink-0 text-muted" />
                      {index === 0
                        ? t("versions.current")
                        : formatRelativeTime(version.createdAt, locale)}
                    </div>
                    <div className="mt-0.5 pl-4 text-[10.5px] text-muted">
                      {fullTime(version.createdAt, locale)} · {formatBytes(version.size)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="min-w-0 flex-1 overflow-y-auto rounded-md border border-border bg-panel">
              {previewError ? (
                <div className="grid h-full place-items-center gap-2 text-sm text-muted">
                  <span>{t("versions.loadFailed")}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setPreviewReload((value) => value + 1)}
                  >
                    {t("library.indexRetry")}
                  </Button>
                </div>
              ) : preview === null || !diff ? (
                <div className="grid h-full place-items-center text-sm text-muted">
                  {t("editor.loadingEditor")}
                </div>
              ) : (
                <>
                  <div className="sticky top-0 flex items-center gap-3 border-b border-border bg-panel px-3 py-1.5 text-[10.5px] text-muted">
                    <span>{t("versions.diffFallback")}</span>
                    <span className="text-code-string">+{diff.added}</span>
                    <span className="text-danger">-{diff.removed}</span>
                    {diff.simplified && <span>{t("versions.diffFallback")}</span>}
                  </div>
                  <pre className="p-3 font-mono text-[11.5px] leading-[1.65] whitespace-pre-wrap">
                    {diff.lines.map((line, index) => (
                      <div
                        className={cn(
                          "px-1",
                          line.kind === "add" && "bg-code-string/14",
                          line.kind === "remove" && "bg-danger/14",
                          line.kind === "same" && "text-muted",
                        )}
                        key={index}
                      >
                        <span className="mr-2 inline-block w-2 text-muted">
                          {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                        </span>
                        {line.text || " "}
                      </div>
                    ))}
                  </pre>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <AlertDialog
        confirmLabel={t("versions.restore")}
        description={t("versions.restoreConfirmBody")}
        onClose={() => {
          setConfirmOpen(false);
          pendingConfirmRef.current?.(false);
          pendingConfirmRef.current = null;
        }}
        onConfirm={() => {
          pendingConfirmRef.current?.(true);
          pendingConfirmRef.current = null;
        }}
        open={confirmOpen}
        title={t("versions.restoreConfirmTitle")}
      />
    </>
  );
}

function fullTime(ms: number, locale: AppLocale) {
  return new Date(ms).toLocaleString(dateLocale(locale));
}

type DiffLine = { kind: "same" | "add" | "remove"; text: string };
type DiffResult = { lines: DiffLine[]; added: number; removed: number; simplified: boolean };
const MAX_LCS_CELLS = 600_000;
const MAX_RENDERED_DIFF_LINES = 4000;

/**
 * Line diff between two documents. Common leading/trailing lines are kept
 * as-is; the middle is matched with an LCS table (Uint16Array) so both
 * directions can be walked into a compact edit script. Oversized inputs
 * degrade to a whole-block replace.
 */
function computeLineDiff(
  before: string,
  after: string,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): DiffResult {
  const a = before.split("\n");
  const b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const head: DiffLine[] = a.slice(0, prefix).map((text) => ({ kind: "same", text }));
  const tail: DiffLine[] = suffix
    ? a.slice(a.length - suffix).map((text) => ({ kind: "same", text }))
    : [];
  const beforeMiddle = a.slice(prefix, a.length - suffix);
  const afterMiddle = b.slice(prefix, b.length - suffix);
  const cells = beforeMiddle.length * afterMiddle.length;
  const simplified = cells > MAX_LCS_CELLS;
  const middle = simplified
    ? [
        ...beforeMiddle.map((text): DiffLine => ({ kind: "remove", text })),
        ...afterMiddle.map((text): DiffLine => ({ kind: "add", text })),
      ]
    : computeMiddleLcs(beforeMiddle, afterMiddle);
  const added = middle.filter((line) => line.kind === "add").length;
  const removed = middle.filter((line) => line.kind === "remove").length;
  const lines = limitDiffLines([...head, ...middle, ...tail], t);
  return { lines, added, removed, simplified };
}

function computeMiddleLcs(a: string[], b: string[]): DiffLine[] {
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    const row = i * width;
    const nextRow = (i + 1) * width;
    for (let j = b.length - 1; j >= 0; j--) {
      table[row + j] =
        a[i] === b[j]
          ? table[nextRow + j + 1] + 1
          : Math.max(table[nextRow + j], table[row + j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      lines.push({ kind: "remove", text: a[i] });
      i++;
    } else {
      lines.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) lines.push({ kind: "remove", text: a[i++] });
  while (j < b.length) lines.push({ kind: "add", text: b[j++] });
  return lines;
}

function limitDiffLines(
  lines: DiffLine[],
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): DiffLine[] {
  if (lines.length <= MAX_RENDERED_DIFF_LINES) return lines;
  const before = Math.floor((MAX_RENDERED_DIFF_LINES - 1) / 2);
  const after = MAX_RENDERED_DIFF_LINES - before - 1;
  const hidden = lines.length - before - after;
  return [
    ...lines.slice(0, before),
    { kind: "same", text: t("versions.hiddenLines", { count: hidden }) },
    ...lines.slice(-after),
  ];
}
