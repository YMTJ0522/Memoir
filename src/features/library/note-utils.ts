import GithubSlugger from "github-slugger";
import matter from "gray-matter";
import type { NoteSortDirection, NoteSortField } from "../../domain/settings";
import {
  normalizeTag,
  type HeadingItem,
  type LibraryPage,
  type LibraryQuery,
  type LibraryStats,
  type NoteMeta,
  type NavFilter,
  type RawNoteFile,
  type ScopedFilter,
} from "../../domain/notes";

export { addUniqueTags, normalizeTag, parseTagTokens } from "../../domain/notes";

export function stripFrontmatter(content: string) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export function fileNameTitle(fallback: string) {
  return fallback.replace(/\.(md|mdx)$/i, "").trim();
}

export function noteDisplayName(note: Pick<NoteMeta, "fileName" | "relativePath">) {
  return (
    fileNameTitle(note.fileName) ||
    fileNameTitle(note.relativePath.split("/").pop() || "") ||
    "Untitled"
  );
}

export function noteExtension(relativePath: string) {
  const match = relativePath.match(/\.(md|mdx)$/i);
  return match ? match[0] : "";
}

export function resolveNoteRenamePath(from: string, input: string) {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (!trimmed) return from;
  if (trimmed.includes("/")) return trimmed.replace(/^\/+/, "");
  const folder = folderName(from);
  const extension = noteExtension(from);
  const fileName = noteExtension(trimmed) ? trimmed : `${trimmed}${extension}`;
  return folder ? `${folder}/${fileName}` : fileName;
}

function frontmatterTitle(data: Record<string, unknown>) {
  const title = data.title;
  return typeof title === "string" ? title.trim() : "";
}

function headingText(raw: string) {
  return raw.replace(/[#`*_~]/g, "").replace(/\s+/g, " ").trim();
}

function htmlHeadingText(raw: string) {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function visibleMarkdown(content: string) {
  let inFence = false;
  const lines: string[] = [];
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      lines.push("");
      continue;
    }
    lines.push(inFence ? "" : line);
  }
  return lines.join("\n");
}

function firstLevelOneHeading(content: string) {
  const visible = visibleMarkdown(stripFrontmatter(content));
  const atx = /^#\s+(.+)$/m.exec(visible);
  const html = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(visible);
  const atxIndex = atx?.index ?? Number.POSITIVE_INFINITY;
  const htmlIndex = html?.index ?? Number.POSITIVE_INFINITY;
  if (atx && atxIndex < htmlIndex) return headingText(atx[1]);
  if (html) return htmlHeadingText(html[1]);
  return "";
}

export function extractTitle(content: string, fallback: string) {
  return firstLevelOneHeading(content) || fileNameTitle(fallback) || "Untitled";
}

export function buildExcerpt(content: string) {
  const text = content
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`~[\](){}!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let sliced = text.slice(0, 150);
  const last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}

export type ParsedNote = {
  body: string;
  title: string;
  tags: string[];
  excerpt: string;
  /** Raw frontmatter data when the note opens with a `---` block, else null. */
  frontmatter: Record<string, unknown> | null;
};

export function parseNote(content: string, fallbackTitle: string): ParsedNote {
  try {
    const parsed = matter(content);
    const body = stripFrontmatter(parsed.content);
    const title = frontmatterTitle(parsed.data) || extractTitle(parsed.content, fallbackTitle);
    const rawTags = parsed.data.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.map(String).filter(Boolean)
      : typeof rawTags === "string"
        ? rawTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];
    const hasFrontmatterBlock = /^---\r?\n/.test(content);
    const frontmatterData = hasFrontmatterBlock && Object.keys(parsed.data).length > 0
      ? (parsed.data as Record<string, unknown>)
      : null;

    return { body, title, tags, excerpt: buildExcerpt(body), frontmatter: frontmatterData };
  } catch {
    const body = stripFrontmatter(content);
    return {
      body,
      title: extractTitle(body, fallbackTitle),
      tags: [],
      excerpt: buildExcerpt(body),
      frontmatter: null,
    };
  }
}

export function countWords(content: string) {
  const cjk = content.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const latin = content.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length || 0;
  return cjk + latin;
}

export function folderName(relativePath: string) {
  if (!relativePath.includes("/")) return "";
  return relativePath.slice(0, relativePath.lastIndexOf("/"));
}

export function isRootFolder(name: string) {
  return name === "";
}

export function noteBelongsToFolder(relativePath: string, folder: string) {
  const noteFolder = folderName(relativePath);
  if (isRootFolder(folder)) return isRootFolder(noteFolder);
  return noteFolder === folder || noteFolder.startsWith(`${folder}/`);
}

const NOTE_SORT_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

export function compareNotesByFileName(
  left: Pick<NoteMeta, "fileName" | "relativePath">,
  right: Pick<NoteMeta, "fileName" | "relativePath">,
  locales?: string | string[],
) {
  return (
    left.relativePath.localeCompare(right.relativePath, locales, NOTE_SORT_OPTIONS) ||
    left.fileName.localeCompare(right.fileName, locales, NOTE_SORT_OPTIONS)
  );
}

export type NoteSort = {
  field: NoteSortField;
  direction: NoteSortDirection;
};

export const DEFAULT_NOTE_SORT: NoteSort = { field: "name", direction: "asc" };

export function sortLibraryNotes<
  T extends Pick<NoteMeta, "fileName" | "relativePath" | "modifiedMs" | "title">,
>(notes: T[], sort: NoteSort = DEFAULT_NOTE_SORT, locales?: string | string[]) {
  const next = [...notes];
  const direction = sort.direction === "desc" ? -1 : 1;
  next.sort((left, right) => {
    const compared =
      sort.field === "modified"
        ? left.modifiedMs - right.modifiedMs
        : sort.field === "title"
          ? left.title.localeCompare(right.title, locales, NOTE_SORT_OPTIONS)
          : compareNotesByFileName(left, right, locales);
    return (compared || compareNotesByFileName(left, right, locales)) * direction;
  });
  return next;
}

export function uniqueSorted(values: string[], locales?: string | string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, locales));
}

export function extractHeadings(content: string): HeadingItem[] {
  const slugger = new GithubSlugger();
  const headings: HeadingItem[] = [];
  let inFence = false;

  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/[#`*_~]/g, "").trim();
    if (!text) continue;
    headings.push({ id: slugger.slug(text), depth: match[1].length, text });
  }

  return headings;
}

export function filterNotes(
  notes: NoteMeta[],
  query: string,
  navFilter: NavFilter,
  scopedFilter: ScopedFilter,
  now = Date.now(),
) {
  const normalizedQuery = query.trim().toLowerCase();
  return notes.filter((note) => {
    if (navFilter === "recent" && now - note.modifiedMs > 7 * 86_400_000) return false;
    if (navFilter === "favorites" && !note.favorite) return false;
    if (navFilter === "uncategorized" && note.tags.length > 0) return false;
    if (scopedFilter?.type === "folder" && !noteBelongsToFolder(note.relativePath, scopedFilter.value)) {
      return false;
    }
    if (
      scopedFilter?.type === "tag" &&
      !note.tags.some((tag) => normalizeTag(tag) === normalizeTag(scopedFilter.value))
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    return [note.title, note.fileName, note.excerpt, note.relativePath, note.body ?? "", ...note.tags]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

/**
 * Mirrors the Rust search rule (see `query_uses_fts` in query.rs): a query
 * containing any ASCII letter is split into AND tokens; CJK/digit queries are
 * treated as one substring.
 */
function buildSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return /[A-Za-z]/.test(trimmed) ? trimmed.split(/\s+/) : [trimmed];
}

/** Mirrors Rust `build_snippet` (query.rs): context window around the first hit. */
function buildSnippet(body: string | undefined, terms: string[]): string {
  const source = body ?? "";
  if (!source.trim() || terms.length === 0) return "";
  const hay = source.toLowerCase();
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    const at = hay.indexOf(needle);
    if (at < 0) continue;
    const start = Math.max(0, at - 30);
    const end = Math.min(source.length, at + needle.length + 100);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < source.length ? "…" : "";
    const slice = source.slice(start, end);
    const text = slice.split(/\s+/).filter(Boolean).join(" ") || slice;
    return `${prefix}${text}${suffix}`;
  }
  return "";
}

export function noteStats(content: string) {
  const words = countWords(content);
  return {
    words,
    chars: content.length,
    minutes: Math.max(1, Math.ceil(words / 260)),
  };
}

export function libraryStatsFromNotes(
  notes: Array<Pick<NoteMeta, "relativePath" | "tags" | "modifiedMs"> & { favorite?: boolean }>,
  favoritePaths: string[] | null | undefined,
  now = Date.now(),
): LibraryStats {
  const favorites = new Set(
    favoritePaths ?? notes.filter((note) => note.favorite).map((note) => note.relativePath),
  );
  const folders = new Map<string, number>();
  const tags = new Map<string, { tag: string; count: number }>();
  let recent = 0;
  let uncategorized = 0;
  const notePaths = new Set(notes.map((note) => note.relativePath));
  for (const note of notes) {
    const folder = folderName(note.relativePath);
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
    if (now - note.modifiedMs <= 7 * 86_400_000) recent += 1;
    if (note.tags.length === 0) uncategorized += 1;
    for (const tag of note.tags) {
      const tagNorm = normalizeTag(tag);
      if (!tagNorm) continue;
      const prev = tags.get(tagNorm);
      if (prev) prev.count += 1;
      else tags.set(tagNorm, { tag, count: 1 });
    }
  }
  return {
    total: notes.length,
    recent,
    favorites: [...favorites].filter((path) => notePaths.has(path)).length,
    uncategorized,
    folders: [...folders.entries()].map(([folder, count]) => ({ folder, count })),
    tags: [...tags.entries()].map(([tagNorm, value]) => ({
      tag: value.tag,
      tagNorm,
      count: value.count,
    })),
    truncated: false,
  };
}

export function queryNotesInMemory(
  files: RawNoteFile[],
  query: LibraryQuery,
): LibraryPage {
  const favoritePaths = query.favoritePaths ?? [];
  const favoriteSet = new Set(favoritePaths);
  const metas: NoteMeta[] = files.map((file) => ({
    ...file,
    favorite: favoriteSet.has(file.relativePath),
  }));
  const scoped: ScopedFilter = query.folder != null
    ? { type: "folder", value: query.folder }
    : query.tag != null
      ? { type: "tag", value: query.tag }
      : null;
const filtered = sortLibraryNotes(
    filterNotes(metas, query.q, query.nav, scoped, query.nowMs ?? Date.now()),
  );
  const searchTerms = buildSearchTerms(query.q);
  return {
    notes: filtered.map(({ favorite: _favorite, dirty: _dirty, ...raw }) => {
      if (searchTerms.length > 0) raw.snippet = buildSnippet(raw.body, searchTerms);
      return raw;
    }),
    stats: libraryStatsFromNotes(metas, favoritePaths, query.nowMs ?? Date.now()),
  };
}
