import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getGateways } from "../../gateways";
import { resolveNoteRef, type NoteGraphNode } from "../../domain/note-links";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { NotePreviewArticle } from "./NotePreviewArticle";

const MAX_EMBED_DEPTH = 4;

/** Notes currently being rendered up the `![[ ]]` nesting chain. */
const EmbedChainContext = createContext<ReadonlySet<string>>(new Set());

/**
 * Renders a `![[note]]` embed: resolves the inner reference against the
 * note list, loads the target markdown and shows it in a nested preview.
 * Unresolved references degrade to the same "missing" style as wiki links;
 * circular embeds and overly deep chains render as plain wiki links.
 *
 * `sourcePath` is the note containing the embed (relative paths resolve
 * against it).
 */
export function WikiEmbed({
  inner,
  sourcePath,
  depth = 0,
}: {
  inner: string;
  sourcePath: string | null;
  depth?: number;
}) {
  const { t } = useI18n();
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const notes = useAppStore((state) => state.notes);
  const selectNote = useAppStore((state) => state.selectNote);
  const chain = useContext(EmbedChainContext);
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const catalog: NoteGraphNode[] = useMemo(
    () =>
      notes.map((note) => ({
        relativePath: note.relativePath,
        title: note.title,
        folder: "",
      })),
    [notes],
  );

  const target = sourcePath
    ? resolveNoteRef(inner.split("|")[0] || "", sourcePath, catalog)
    : undefined;

  const cycle = Boolean(target && chain.has(target));
  const exceedsDepth = depth >= MAX_EMBED_DEPTH;
  const blocked = !target || cycle || exceedsDepth;

  useEffect(() => {
    if (blocked) return;
    let cancelled = false;
    setFailed(false);
    setBody(null);
    getGateways()
      .workspace.readNote(workspaceRoot || "", target || "")
      .then((content) => {
        if (!cancelled) setBody(content);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [blocked, target, workspaceRoot]);

  if (blocked || failed) {
    const clickable = Boolean(target) && !cycle && !exceedsDepth;
    return (
      <a
        className={clickable ? "wiki-link memoir-wiki-embed-missing" : "wiki-link is-missing memoir-wiki-embed-missing"}
        href="#"
        title={
          cycle
            ? t("preview.embedCycle")
            : exceedsDepth
              ? t("preview.embedTooDeep")
              : t("preview.missingWikiLink", { name: inner })
        }
        onClick={(event) => {
          event.preventDefault();
          if (clickable) void selectNote(target || "");
        }}
      >
        {`![[${inner}]]`}
      </a>
    );
  }

  const nextChain = useMemo(() => {
    const next = new Set(chain);
    if (target) next.add(target);
    return next;
  }, [chain, target]);

  return (
    <span className="memoir-wiki-embed" data-embed-path={target || undefined}>
      {body === null ? (
        <span className="memoir-wiki-embed-loading">{t("preview.embedLoading")}</span>
      ) : (
        <EmbedChainContext.Provider value={nextChain}>
          <NotePreviewArticle
            className="memoir-preview memoir-wiki-embed-article"
            compileDelay={0}
            content={body || ""}
            note={null}
            relativePath={target || ""}
            root={workspaceRoot}
          />
        </EmbedChainContext.Provider>
      )}
    </span>
  );
}
