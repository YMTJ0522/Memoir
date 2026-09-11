import type { AppState, LegacyStatePayload } from "../domain/app-state";
import { isPreviewableHttpUrl, LINK_PREVIEW_HTML_LIMIT } from "../domain/link-preview";
import type { AppUpdateCheck } from "../domain/app-update";
import { APP_STATE_VERSION } from "../domain/app-state";
import { DEFAULT_WORKSPACE_LAYOUT, mergeLayout, type WorkspaceLayoutState } from "../domain/layout";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import {
  ARCHIVE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  attachmentRelativePath,
  extensionFromFileName,
  extensionFromMime,
  mimeFromExtension,
  sanitizeAttachmentFileName,
} from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import { resolveWorkspaceFilePath } from "../domain/paths";
import {
  folderAppearancesForWorkspace,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "../domain/folders";
import { indexInfoFromNotes, type WorkspaceIndexInfo } from "../domain/index-info";
import { buildNoteGraph, type NoteGraph } from "../domain/note-links";
import type {
  LibraryPage,
  LibraryQuery,
  NoteVersion,
  NoteVersionMeta,
  RawNoteFile,
  RenamedNote,
} from "../domain/notes";
import { parseNote, queryNotesInMemory } from "../features/library/note-utils";
import {
  convertDocxHtml,
  convertImportedSource,
  importSourceExtension,
} from "../features/import/import-article";
import { DEFAULT_SETTINGS } from "../domain/settings";
import type { TrashEntry } from "../domain/trash";
import { APP_VERSION } from "../platform/app-version";
import {
  defaultCloudSyncProfile,
  mergeCloudSyncProfile,
  type CloudSyncProfile,
  type CloudSyncProfileInput,
  type CloudSyncProgress,
} from "../domain/cloud-sync";
import { GatewayError } from "../domain/errors";
import { EXPORT_FILTERS, type ExportDialogOptions } from "./contracts";
import type {
  AiChatCompletionInput,
  AiChatReply,
  AiGateway,
  AiSessionRecord,
  AppGateways,
  CloudSyncGateway,
  CreateNoteInput,
  PersistenceGateway,
  WorkspaceGateway,
} from "./contracts";

const DEMO_ROOT = "demo://memoir";
const BROWSER_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const BROWSER_SNAPSHOT_DIFF_THRESHOLD = 400;
const BROWSER_MAX_VERSIONS_PER_NOTE = 50;
const DEMO_NOTES: Array<[string, string]> = [
  [
    "welcome.mdx",
    `---
title: Welcome to Memoir
tags: [memoir, mdx]
---

# Welcome to Memoir

This in-memory demo supports **Markdown**, MDX components, Mermaid, and editing.

Try a file reference: [[今日记录]] or [[Two Sum]].

<Callout type="tip" title="Browser demo">
  Browser preview never writes real app state to localStorage.
</Callout>
`,
  ],
  [
    "日记/today.md",
    `---
title: 今日记录
tags: [diary]
---

# 今日记录

写一点今天的事。

灵感来自 [[Welcome to Memoir]]，未完成的想法放在 [[随手记]]。
`,
  ],
  [
    "思考/inbox.md",
    `---
title: 随手记
tags: [ideas]
---

# 随手记

把念头先放在这里。

也可以回到 [今日记录](../日记/today.md)。
`,
  ],
  [
    "LeetCode/two-sum.md",
    `---
title: Two Sum
tags: [leetcode]
---

# Two Sum

Practice note for the classic problem.

See [[Welcome to Memoir]] for the vault layout.
`,
  ],
];

function yamlQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlTags(tags?: string[]) {
  const quoted = (tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map(yamlQuote);
  return quoted.length ? `[${quoted.join(", ")}]` : "[]";
}

function createDefaultState(): AppState {
  return {
    version: APP_STATE_VERSION,
    preferences: DEFAULT_SETTINGS,
    recentWorkspaces: [],
    lastWorkspace: null,
    sidebarCollapsed: false,
    layout: DEFAULT_WORKSPACE_LAYOUT,
    favorites: {},
    folderAppearances: {},
  };
}

export class BrowserWorkspaceGateway implements WorkspaceGateway {
  private files = new Map<string, string>(DEMO_NOTES);
  private modified = new Map<string, number>(DEMO_NOTES.map(([path]) => [path, Date.now()]));
  private attachments = new Map<string, AttachmentFile>();
  private media = new Map<string, string>();
  /** Soft-deleted notes/attachments, keyed by trash file name. */
  private trash = new Map<string, TrashEntry>();
  /** Original note content / attachment data URL preserved for restore. */
  private trashContent = new Map<string, string>();
  /** Files previously chosen for article import, keyed by name (drop re-imports). */
  private importedArticles = new Map<string, File>();

  async chooseWorkspace(_title?: string) {
    return DEMO_ROOT;
  }

  private listNotes(): RawNoteFile[] {
    return [...this.files.entries()].map(([relativePath, content]) => {
      const fileName = relativePath.split("/").pop() || relativePath;
      const parsed = parseNote(content, fileName);
      return {
        relativePath,
        fileName,
        extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
        modifiedMs: this.modified.get(relativePath) || Date.now(),
        size: new Blob([content]).size,
        title: parsed.title,
        tags: parsed.tags,
        excerpt: parsed.excerpt,
        body: parsed.body,
      };
    });
  }

  async queryLibrary(root: string, query: LibraryQuery): Promise<LibraryPage> {
    this.assertRoot(root);
    return queryNotesInMemory(this.listNotes(), query);
  }

  async reconcileWorkspace(root: string, query?: LibraryQuery): Promise<LibraryPage> {
    return this.queryLibrary(root, query ?? { q: "", nav: "all", folder: null, tag: null });
  }

  async getNoteGraph(root: string): Promise<NoteGraph> {
    this.assertRoot(root);
    return buildNoteGraph(
      [...this.files.entries()].map(([relativePath, content]) => {
        const fileName = relativePath.split("/").pop() || relativePath;
        return { relativePath, title: parseNote(content, fileName).title, content };
      }),
    );
  }

  async getIndexInfo(root: string): Promise<WorkspaceIndexInfo> {
    const notes = this.listNotes();
    this.assertRoot(root);
    const graph = await this.getNoteGraph(root);
    return indexInfoFromNotes(notes, {
      createdMs: Math.min(...notes.map((note) => note.modifiedMs)),
      lastReconcileMs: Date.now(),
      noteLinkCount: graph.edges.length,
    });
  }

  async rebuildIndex(root: string, query?: LibraryQuery) {
    return this.reconcileWorkspace(root, query);
  }

  async readNote(root: string, relativePath: string) {
    this.assertRoot(root);
    const content = this.files.get(relativePath);
    if (content === undefined) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    return content;
  }

  async writeNote(root: string, relativePath: string, content: string) {
    this.assertRoot(root);
    if (!this.files.has(relativePath)) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    this.files.set(relativePath, content);
    this.modified.set(relativePath, Date.now());
    return this.noteAt(relativePath);
  }

  async createNote({ root, title, extension, folder, tags }: CreateNoteInput) {
    this.assertRoot(root);
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-|-$/g, "") || "untitled";
    const prefix = folder?.replace(/^\/|\/$/g, "");
    let index = 0;
    let relativePath = `${prefix ? `${prefix}/` : ""}${slug}.${extension}`;
    while (this.files.has(relativePath)) {
      index += 1;
      relativePath = `${prefix ? `${prefix}/` : ""}${slug}-${index}.${extension}`;
    }
    this.files.set(
      relativePath,
      `---\ntitle: ${yamlQuote(title)}\ntags: ${yamlTags(tags)}\n---\n\n# ${title}\n`,
    );
    this.modified.set(relativePath, Date.now());
    return this.noteAt(relativePath);
  }

  async importArticles(root: string): Promise<RawNoteFile[]> {
    this.assertRoot(root);
    const files = await pickArticleFiles();
    return this.importArticleFiles(root, files);
  }

  async importArticlesFromPaths(root: string, sourcePaths: string[]): Promise<RawNoteFile[]> {
    this.assertRoot(root);
    // The browser demo has no external paths; callers only hand us file names
    // that were registered from previous imports.
    return this.importArticleFiles(
      root,
      sourcePaths
        .map((path) => this.importedArticles.get(path))
        .filter((file): file is File => Boolean(file)),
    );
  }

  private async importArticleFiles(root: string, files: File[]): Promise<RawNoteFile[]> {
    this.assertRoot(root);
    const imported: RawNoteFile[] = [];
    for (const file of files) {
      const extension = importSourceExtension(file.name);
      if (!extension) continue;
      this.importedArticles.set(file.name, file);
      const bytesBase64 = await readFileBase64(file);
      const text = extension === "docx" ? await convertDocxHtml(bytesBase64) : await file.text();
      const article = convertImportedSource({ fileName: file.name, extension, text });
      const slug = article.title
        .trim()
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
        .replace(/^-|-$/g, "") || "untitled";
      let index = 0;
      let relativePath = `${slug}.md`;
      while (this.files.has(relativePath)) {
        index += 1;
        relativePath = `${slug}-${index}.md`;
      }
      this.files.set(
        relativePath,
        `---\ntitle: ${yamlQuote(article.title)}\ntags: []\n---\n\n${article.markdown}\n`,
      );
      this.modified.set(relativePath, Date.now());
      imported.push(this.noteAt(relativePath));
    }
    return imported;
  }

  async renameNote(root: string, oldRelativePath: string, newRelativePath: string): Promise<RenamedNote> {
    this.assertRoot(root);
    const content = this.files.get(oldRelativePath);
    if (content === undefined) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    if (this.files.has(newRelativePath)) {
      throw new GatewayError({ code: "conflict", message: "A demo note already exists there." });
    }
    this.files.delete(oldRelativePath);
    this.files.set(newRelativePath, content);
    this.modified.set(newRelativePath, Date.now());
    return { oldPath: oldRelativePath, note: this.noteAt(newRelativePath) };
  }

  async deleteNote(root: string, relativePath: string) {
    this.assertRoot(root);
    const content = this.files.get(relativePath);
    if (content === undefined) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    const trashName = this.trashName(relativePath);
    this.files.delete(relativePath);
    this.trash.set(trashName, {
      trashName,
      originalPath: relativePath,
      trashPath: `.memoir-trash/${trashName}`,
      deletedAtMs: Date.now(),
      size: new Blob([content]).size,
      isAttachment: false,
    });
    this.trashContent.set(trashName, content);
    return `.memoir-trash/${trashName}`;
  }

  async scanAttachments(root: string) {
    this.assertRoot(root);
    return [...this.attachments.values()].sort(
      (left, right) => right.modifiedMs - left.modifiedMs || left.relativePath.localeCompare(right.relativePath),
    );
  }

  async saveAttachment(root: string, input: SaveAttachmentInput) {
    this.assertRoot(root);
    const extension =
      extensionFromFileName(input.fileName || "") || extensionFromMime(input.mimeType || "") || "png";
    const stem = sanitizeAttachmentFileName((input.fileName || "image").replace(/\.[^.]+$/, ""));
    let fileName = `${stem}.${extension}`;
    let index = 1;
    let relativePath = attachmentRelativePath(fileName);
    while (this.attachments.has(relativePath)) {
      fileName = `${stem}-${index}.${extension}`;
      relativePath = attachmentRelativePath(fileName);
      index += 1;
    }
    const attachment: AttachmentFile = {
      relativePath,
      fileName,
      extension,
      mimeType: mimeFromExtension(extension),
      modifiedMs: Date.now(),
      size: Math.ceil((input.bytesBase64.length * 3) / 4),
    };
    this.attachments.set(relativePath, attachment);
    const dataUrl = `data:${attachment.mimeType};base64,${input.bytesBase64}`;
    this.media.set(relativePath, dataUrl);
    this.media.set(resolveWorkspaceFilePath(DEMO_ROOT, relativePath), dataUrl);
    return attachment;
  }

  async importAttachments(root: string) {
    this.assertRoot(root);
    const files = await pickBrowserFiles();
    const imported: AttachmentFile[] = [];
    for (const file of files) {
      const bytesBase64 = await blobToBase64(file);
      imported.push(
        await this.saveAttachment(root, {
          bytesBase64,
          fileName: file.name,
          mimeType: file.type,
        }),
      );
    }
    return imported;
  }

  async importAttachmentsFromPaths(_root: string, _sourcePaths: string[]) {
    return [];
  }

  async deleteAttachment(root: string, relativePath: string) {
    this.assertRoot(root);
    const attachment = this.attachments.get(relativePath);
    if (!attachment) {
      throw new GatewayError({ code: "not_found", message: "Demo attachment does not exist." });
    }
    const trashName = this.trashName(relativePath);
    this.attachments.delete(relativePath);
    this.media.delete(relativePath);
    this.media.delete(resolveWorkspaceFilePath(DEMO_ROOT, relativePath));
    this.trash.set(trashName, {
      trashName,
      originalPath: relativePath,
      trashPath: `.memoir-trash/${trashName}`,
      deletedAtMs: Date.now(),
      size: attachment.size,
      isAttachment: true,
    });
    this.trashContent.set(trashName, this.media.get(relativePath) ?? "");
    return `.memoir-trash/${trashName}`;
  }

  async listTrash(root: string) {
    this.assertRoot(root);
    return [...this.trash.values()].sort(
      (left, right) => right.deletedAtMs - left.deletedAtMs || left.trashName.localeCompare(right.trashName),
    );
  }

  async restoreTrashItem(root: string, trashName: string) {
    this.assertRoot(root);
    const entry = this.trash.get(trashName);
    if (!entry) {
      throw new GatewayError({ code: "not_found", message: "Trash item does not exist." });
    }
    const target = entry.originalPath;
    const content = this.trashContent.get(trashName) ?? "";
    if (entry.isAttachment) {
      const attachment = {
        relativePath: target,
        fileName: target.split("/").pop() || target,
        extension: extensionFromFileName(target) || "png",
        mimeType: mimeFromExtension(extensionFromFileName(target) || "png"),
        modifiedMs: Date.now(),
        size: entry.size,
      };
      this.attachments.set(target, attachment);
      if (content) this.media.set(target, content);
    } else {
      this.files.set(target, content);
      this.modified.set(target, Date.now());
    }
    this.trash.delete(trashName);
    this.trashContent.delete(trashName);
    return target;
  }

  async purgeTrashItem(root: string, trashName: string) {
    this.assertRoot(root);
    if (!this.trash.delete(trashName)) {
      throw new GatewayError({ code: "not_found", message: "Trash item does not exist." });
    }
    this.trashContent.delete(trashName);
  }

  async emptyTrash(root: string) {
    this.assertRoot(root);
    this.trash.clear();
    this.trashContent.clear();
  }

  async openPath() {}

  async revealPath() {}

  async openExternal(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async fetchLinkPreviewHtml(url: string) {
    if (!isPreviewableHttpUrl(url)) {
      throw new GatewayError({ code: "invalid_path", message: "Only http(s) URLs can be previewed." });
    }
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new GatewayError({
        code: "io",
        message: "Unable to load the link preview.",
        details: `HTTP ${response.status}`,
      });
    }
    const text = await response.text();
    return text.slice(0, LINK_PREVIEW_HTML_LIMIT);
  }

  resolveMediaPath(path: string) {
    return this.media.get(path) ?? path;
  }

  async chooseExportPath({ defaultPath }: { defaultPath: string; title?: string }) {
    return defaultPath.split(/[\\/]/).pop() || "note.pdf";
  }

  async chooseExportFile({ defaultPath, format }: ExportDialogOptions) {
    const extension = EXPORT_FILTERS[format].extensions[0];
    const base = defaultPath.split(/[\\/]/).pop() || `note.${extension}`;
    return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
  }

  async writeExportFile(path: string, bytesBase64: string) {
    const fileName = path.split(/[\\/]/).pop() || "note.pdf";
    const binary = atob(bytesBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const anchor = document.createElement("a");
    anchor.download = fileName;
    anchor.href = url;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async writeExportText(path: string, text: string, mime: string) {
    const fileName = path.split(/[\\/]/).pop() || "note.txt";
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = document.createElement("a");
    anchor.download = fileName;
    anchor.href = url;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private noteAt(relativePath: string): RawNoteFile {
    const content = this.files.get(relativePath) ?? "";
    const fileName = relativePath.split("/").pop() || relativePath;
    const parsed = parseNote(content, fileName);
    return {
      relativePath,
      fileName,
      extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
      modifiedMs: this.modified.get(relativePath) || Date.now(),
      size: new Blob([content]).size,
      title: parsed.title,
      tags: parsed.tags,
      excerpt: parsed.excerpt,
      body: parsed.body,
    };
  }

  private trashName(relativePath: string) {
    const fileName = relativePath.split("/").pop() || relativePath;
    return `${Math.floor(Date.now() / 1000)}-${fileName}`;
  }

  private assertRoot(root: string) {
    if (root !== DEMO_ROOT) {
      throw new GatewayError({ code: "invalid_path", message: "Browser mode only supports the demo workspace." });
    }
  }
}

export class BrowserPersistenceGateway implements PersistenceGateway {
  private state = createDefaultState();
  private drafts = new Map<string, string>();
  private noteVersions = new Map<string, NoteVersion[]>();

  async loadAppState() {
    return structuredClone(this.state);
  }

  async savePreferences(
    preferences: AppState["preferences"],
    lastWorkspace: string | null,
    sidebarCollapsed: boolean,
    layout?: WorkspaceLayoutState,
  ) {
    this.state = {
      ...this.state,
      preferences,
      lastWorkspace,
      sidebarCollapsed,
      layout: layout ? mergeLayout(layout) : this.state.layout ?? DEFAULT_WORKSPACE_LAYOUT,
      recentWorkspaces:
        lastWorkspace === DEMO_ROOT
          ? [DEMO_ROOT, ...this.state.recentWorkspaces.filter((root) => root !== DEMO_ROOT)]
          : this.state.recentWorkspaces,
    };
    return structuredClone(this.state);
  }

  async saveAiSessions(sessions: AiSessionRecord[], activeAiSessionId: string | null) {
    this.state = { ...this.state, aiSessions: sessions, activeAiSessionId };
  }

  async setFavorite(workspaceRoot: string, relativePath: string, favorite: boolean) {
    const current = new Set(this.state.favorites[workspaceRoot] || []);
    if (favorite) current.add(relativePath);
    else current.delete(relativePath);
    this.state = {
      ...this.state,
      favorites: { ...this.state.favorites, [workspaceRoot]: [...current] },
    };
    return structuredClone(this.state);
  }

  async setFolderAppearance(
    workspaceRoot: string,
    folder: string,
    appearance: FolderAppearance | null,
  ) {
    const key = normalizeFolderKey(folder);
    const current = folderAppearancesForWorkspace(this.state.folderAppearances, workspaceRoot);
    const nextAppearance = appearance ? normalizeFolderAppearance(appearance) : undefined;
    if (nextAppearance) current[key] = nextAppearance;
    else delete current[key];
    const folderAppearances = { ...this.state.folderAppearances };
    if (Object.keys(current).length) folderAppearances[workspaceRoot] = current;
    else delete folderAppearances[workspaceRoot];
    this.state = { ...this.state, folderAppearances };
    return structuredClone(this.state);
  }

  async readDraft(workspaceRoot: string, relativePath: string) {
    return this.drafts.get(`${workspaceRoot}\0${relativePath}`) ?? null;
  }

  async writeDraft(workspaceRoot: string, relativePath: string, content: string) {
    this.drafts.set(`${workspaceRoot}\0${relativePath}`, content);
  }

  async deleteDraft(workspaceRoot: string, relativePath: string) {
    this.drafts.delete(`${workspaceRoot}\0${relativePath}`);
  }

  async draftsExist(workspaceRoot: string, relativePaths: string[]) {
    return relativePaths.filter((relativePath) =>
      this.drafts.has(`${workspaceRoot}\0${relativePath}`),
    );
  }

  async listNoteVersions(workspaceRoot: string, relativePath: string): Promise<NoteVersionMeta[]> {
    return this.loadVersions(workspaceRoot, relativePath)
      .slice()
      .reverse()
      .map(({ content: _content, ...meta }) => meta);
  }

  async getNoteVersion(
    workspaceRoot: string,
    relativePath: string,
    versionId: string,
  ): Promise<NoteVersion> {
    const version = this.loadVersions(workspaceRoot, relativePath).find(
      (version) => version.id === versionId,
    );
    if (!version) {
      throw new GatewayError({
        code: "not_found",
        message: `Note version ${versionId} does not exist.`,
      });
    }
    return { ...version };
  }

  async snapshotNoteVersion(
    workspaceRoot: string,
    relativePath: string,
    oldContent: string,
    newContent: string,
    preserve = false,
  ): Promise<void> {
    const key = `${workspaceRoot}\0${relativePath}`;
    const versions = this.loadVersions(workspaceRoot, relativePath);
    const latest = versions[versions.length - 1];
    if (latest && !preserve) {
      const intervalElapsed =
        Date.now() - latest.createdAt > BROWSER_SNAPSHOT_INTERVAL_MS;
      const largeChange =
        Math.abs(newContent.length - oldContent.length) >= BROWSER_SNAPSHOT_DIFF_THRESHOLD;
      if (!intervalElapsed && !largeChange) return;
    }
    const now = Date.now();
    const createdAt = latest ? Math.max(now, latest.createdAt + 1) : now;
    versions.push({
      id: `v${createdAt}-${versions.length}`,
      title: parseNote(oldContent, "").title,
      size: oldContent.length,
      createdAt,
      content: oldContent,
    });
    const overflow = versions.length - BROWSER_MAX_VERSIONS_PER_NOTE;
    this.noteVersions.set(key, versions.slice(Math.max(overflow, 0)));
  }

  private loadVersions(workspaceRoot: string, relativePath: string): NoteVersion[] {
    return this.noteVersions.get(`${workspaceRoot}\0${relativePath}`) ?? [];
  }

  async migrateLegacyState(_payload: LegacyStatePayload) {
    return { migratedKeys: [] };
  }

  async checkAppUpdate(): Promise<AppUpdateCheck> {
    return {
      status: "upToDate",
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      releaseUrl: null,
      releaseNotes: null,
    };
  }

  async skipAppUpdate(_version: string) {}
}

export class BrowserCloudSyncGateway implements CloudSyncGateway {
  private profiles = new Map<string, CloudSyncProfile>();

  async getProfile(workspaceRoot: string) {
    return mergeCloudSyncProfile(this.profiles.get(workspaceRoot) ?? defaultCloudSyncProfile());
  }

  async saveProfile(workspaceRoot: string, profile: CloudSyncProfileInput) {
    const current = await this.getProfile(workspaceRoot);
    const next = mergeCloudSyncProfile({ ...current, ...profile });
    this.profiles.set(workspaceRoot, next);
    return next;
  }

  async testConnection(_profile: CloudSyncProfileInput): Promise<never> {
    throw new GatewayError({
      code: "io",
      message: "Cloud sync is only available in the desktop app.",
    });
  }

  async runSync(_workspaceRoot: string, _profile?: CloudSyncProfileInput): Promise<never> {
    throw new GatewayError({
      code: "io",
      message: "Cloud sync is only available in the desktop app.",
    });
  }

  async watchProgress(_onProgress: (progress: CloudSyncProgress) => void) {
    return () => undefined;
  }
}

/** Browser demo: echoes a canned Markdown reply after a short delay. */
export class BrowserAiGateway implements AiGateway {
  async chatCompletion(input: AiChatCompletionInput): Promise<string> {
    return this.cannedReply(input);
  }

  async chatCompletionStream(
    input: AiChatCompletionInput,
    _requestId: string,
    onDelta: (piece: string) => void,
    onReasoning: (piece: string) => void,
  ): Promise<AiChatReply> {
    // Simulate a reasoning trace followed by a typewriter-style content stream.
    const reasoning = "浏览器演示模式，未连接真实 AI 服务。";
    const content = await this.cannedReply(input);
    for (const piece of reasoning) {
      onReasoning(piece);
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    for (const piece of content) {
      onDelta(piece);
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
    return { content, reasoning, toolCalls: [] };
  }

  private async cannedReply(input: AiChatCompletionInput): Promise<string> {
    const last = [...input.messages].reverse().find((message) => message.role === "user");
    const prompt = last?.content ?? "";
    await new Promise((resolve) => setTimeout(resolve, 400));
    return [
      "> 浏览器演示模式，未连接真实 AI 服务。",
      "",
      "您刚才的问题是：",
      "",
      `> ${prompt.split("\n").join("\n> ")}`,
      "",
      "在桌面版 Memoir 中，设置页配置 AI 模型后即可获得真实回复。",
    ].join("\n");
  }

  async testConnection(): Promise<string> {
    throw new GatewayError({
      code: "io",
      message: "AI 连接测试仅在桌面版可用。",
    });
  }
}

function blobToBase64(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function pickBrowserFiles() {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = [
      ...IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
      ...VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
      ...AUDIO_EXTENSIONS.map((extension) => `.${extension}`),
      ...DOCUMENT_EXTENSIONS.map((extension) => `.${extension}`),
      ...ARCHIVE_EXTENSIONS.map((extension) => `.${extension}`),
    ].join(",");
    input.multiple = true;
    input.hidden = true;
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])), { once: true });
    document.body.append(input);
    input.click();
  });
}

function pickArticleFiles() {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.md,.markdown,.html,.htm,.docx";
    input.multiple = true;
    input.hidden = true;
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])), { once: true });
    document.body.append(input);
    input.click();
  });
}

function readFileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function createBrowserGateways(): AppGateways {
  return {
    workspace: new BrowserWorkspaceGateway(),
    persistence: new BrowserPersistenceGateway(),
    cloudSync: new BrowserCloudSyncGateway(),
    ai: new BrowserAiGateway(),
  };
}
