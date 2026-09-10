import type { AppState } from "../domain/app-state";
import { GatewayError } from "../domain/errors";
import type { AppUpdateCheck } from "../domain/app-update";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import { attachmentRelativePath, mimeFromExtension } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
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
import type { TrashEntry } from "../domain/trash";
import { parseNote, queryNotesInMemory } from "../features/library/note-utils";
import {
  convertImportedSource,
  importSourceExtension,
} from "../features/import/import-article";
import { DEFAULT_WORKSPACE_LAYOUT, mergeLayout, type WorkspaceLayoutState } from "../domain/layout";
import { DEFAULT_SETTINGS } from "../domain/settings";
import {
  defaultCloudSyncProfile,
  mergeCloudSyncProfile,
  type CloudSyncProfile,
  type CloudSyncProfileInput,
  type CloudSyncProbe,
  type CloudSyncProgress,
  type CloudSyncReport,
  type CloudSyncRunResult,
} from "../domain/cloud-sync";
import type {
  AiChatCompletionInput,
  AiChatReply,
  AiGateway,
  AiSessionRecord,
  AppGateways,
  CloudSyncGateway,
  CreateNoteInput,
  ExportDialogOptions,
  PersistenceGateway,
  WorkspaceGateway,
} from "../gateways/contracts";

function mockYamlQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export class MockWorkspaceGateway implements WorkspaceGateway {
  files = new Map<string, string>([
    ["one.md", "---\ntitle: One\ntags: [test]\n---\n\n# One\n\nOriginal"],
  ]);
  attachments = new Map<string, AttachmentFile>();
  trash = new Map<string, TrashEntry>();
  trashContent = new Map<string, string>();
  writes: Array<{ path: string; content: string }> = [];
  savedAttachments: SaveAttachmentInput[] = [];
  failWrite = false;
  failAttachment = false;
  nextImported: AttachmentFile[] = [];
  failIndex = false;
  rebuildCount = 0;
  reconcileCount = 0;
  queryLibraryCount = 0;
  scanAttachmentCount = 0;
  indexInfoOverrides: Partial<WorkspaceIndexInfo> = {};

  async chooseWorkspace(_title?: string) {
    return "/workspace";
  }

  private listNotes(): RawNoteFile[] {
    return [...this.files.entries()].map(([relativePath, content]) => {
      const fileName = relativePath.split("/").pop() || relativePath;
      const parsed = parseNote(content, fileName);
      return {
        relativePath,
        fileName,
        extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
        modifiedMs: 1,
        size: content.length,
        title: parsed.title,
        tags: parsed.tags,
        excerpt: parsed.excerpt,
        body: parsed.body,
      };
    });
  }

  async queryLibrary(_root: string, query: LibraryQuery): Promise<LibraryPage> {
    this.queryLibraryCount += 1;
    return queryNotesInMemory(this.listNotes(), query);
  }

  async reconcileWorkspace(root: string, query?: LibraryQuery): Promise<LibraryPage> {
    this.reconcileCount += 1;
    return this.queryLibrary(root, query ?? { q: "", nav: "all", folder: null, tag: null });
  }

  async getNoteGraph(): Promise<NoteGraph> {
    return buildNoteGraph(
      [...this.files.entries()].map(([relativePath, content]) => {
        const fileName = relativePath.split("/").pop() || relativePath;
        return { relativePath, title: parseNote(content, fileName).title, content };
      }),
    );
  }

  async getIndexInfo(): Promise<WorkspaceIndexInfo> {
    if (this.failIndex) throw new Error("index locked");
    const notes = this.listNotes();
    return indexInfoFromNotes(notes, {
      persistent: true,
      fileSize: 4096,
      createdMs: 1,
      lastReconcileMs: 2,
      ...this.indexInfoOverrides,
    });
  }

  async rebuildIndex(root: string, query?: LibraryQuery) {
    this.rebuildCount += 1;
    if (this.failIndex) throw new Error("index locked");
    return this.queryLibrary(root, query ?? { q: "", nav: "all", folder: null, tag: null });
  }

  async readNote(_root: string, relativePath: string) {
    const content = this.files.get(relativePath);
    if (content === undefined) throw new Error("missing");
    return content;
  }

  async writeNote(_root: string, relativePath: string, content: string) {
    if (this.failWrite) throw new Error("disk full");
    this.files.set(relativePath, content);
    this.writes.push({ path: relativePath, content });
    return this.noteAt(relativePath);
  }

  async createNote(input: CreateNoteInput) {
    const relativePath = `${input.title.toLowerCase().replace(/\s+/g, "-")}.${input.extension}`;
    this.files.set(relativePath, `# ${input.title}`);
    return this.noteAt(relativePath);
  }

  nextImportedArticles: Array<{ fileName: string; content: string }> = [];
  importedArticlePaths: string[] = [];
  importArticleCalls = 0;

  async importArticles(): Promise<RawNoteFile[]> {
    this.importArticleCalls += 1;
    if (this.failWrite) throw new Error("disk full");
    return this.importArticleSources(this.nextImportedArticles);
  }

  async importArticlesFromPaths(_root: string, sourcePaths: string[]): Promise<RawNoteFile[]> {
    if (this.failWrite) throw new Error("disk full");
    this.importedArticlePaths.push(...sourcePaths);
    const preset = new Map(this.nextImportedArticles.map((source) => [source.fileName, source]));
    const sources = sourcePaths
      .map((sourcePath) => preset.get(sourcePath.split(/[\\/]/).pop() || sourcePath))
      .filter((source): source is { fileName: string; content: string } => Boolean(source));
    return this.importArticleSources(sources);
  }

  private importArticleSources(sources: Array<{ fileName: string; content: string }>): RawNoteFile[] {
    const imported: RawNoteFile[] = [];
    for (const source of sources) {
      const extension = importSourceExtension(source.fileName);
      if (!extension) continue;
      const article = convertImportedSource({
        fileName: source.fileName,
        extension,
        text: source.content,
      });
      const slug =
        article.title
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
        `---\ntitle: ${mockYamlQuote(article.title)}\ntags: []\n---\n\n${article.markdown}\n`,
      );
      imported.push(this.noteAt(relativePath));
    }
    return imported;
  }

  async renameNote(_root: string, oldRelativePath: string, newRelativePath: string): Promise<RenamedNote> {
    const content = this.files.get(oldRelativePath) || "";
    this.files.delete(oldRelativePath);
    this.files.set(newRelativePath, content);
    return { oldPath: oldRelativePath, note: this.noteAt(newRelativePath) };
  }

  async deleteNote(_root: string, relativePath: string) {
    const content = this.files.get(relativePath);
    if (content === undefined) throw new Error("missing");
    const trashName = this.trashName(relativePath);
    this.files.delete(relativePath);
    this.trash.set(trashName, {
      trashName,
      originalPath: relativePath,
      trashPath: `.memoir-trash/${trashName}`,
      deletedAtMs: Date.now(),
      size: content.length,
      isAttachment: false,
    });
    this.trashContent.set(trashName, content);
    return `.memoir-trash/${trashName}`;
  }

  async listTrash(_root: string) {
    return [...this.trash.values()].sort(
      (left, right) => right.deletedAtMs - left.deletedAtMs || left.trashName.localeCompare(right.trashName),
    );
  }

  async restoreTrashItem(_root: string, trashName: string) {
    const entry = this.trash.get(trashName);
    if (!entry) {
      throw new GatewayError({ code: "not_found", message: "Trash item does not exist." });
    }
    const content = this.trashContent.get(trashName) ?? "";
    if (entry.isAttachment) {
      const attachment: AttachmentFile = {
        relativePath: entry.originalPath,
        fileName: entry.originalPath.split("/").pop() || entry.originalPath,
        extension: entry.originalPath.split(".").pop() || "png",
        mimeType: mimeFromExtension(entry.originalPath.split(".").pop() || "png"),
        modifiedMs: Date.now(),
        size: entry.size,
      };
      this.attachments.set(entry.originalPath, attachment);
    } else {
      this.files.set(entry.originalPath, content);
    }
    this.trash.delete(trashName);
    this.trashContent.delete(trashName);
    return entry.originalPath;
  }

  async purgeTrashItem(_root: string, trashName: string) {
    if (!this.trash.delete(trashName)) {
      throw new GatewayError({ code: "not_found", message: "Trash item does not exist." });
    }
    this.trashContent.delete(trashName);
  }

  async emptyTrash(_root: string) {
    this.trash.clear();
    this.trashContent.clear();
  }

  async scanAttachments(): Promise<AttachmentFile[]> {
    this.scanAttachmentCount += 1;
    return [...this.attachments.values()];
  }

  async saveAttachment(_root: string, input: SaveAttachmentInput) {
    if (this.failAttachment) throw new Error("attachment disk full");
    this.savedAttachments.push(input);
    const fileName = input.fileName || "paste.png";
    const relativePath = attachmentRelativePath(fileName);
    const attachment: AttachmentFile = {
      relativePath,
      fileName,
      extension: fileName.split(".").pop() || "png",
      mimeType: input.mimeType || mimeFromExtension(fileName.split(".").pop() || "png"),
      modifiedMs: Date.now(),
      size: 12,
    };
    this.attachments.set(relativePath, attachment);
    return attachment;
  }

  importedPaths: string[] = [];

  async importAttachments() {
    if (this.failAttachment) throw new Error("attachment disk full");
    for (const attachment of this.nextImported) {
      this.attachments.set(attachment.relativePath, attachment);
    }
    return [...this.nextImported];
  }

  async importAttachmentsFromPaths(_root: string, sourcePaths: string[]) {
    if (this.failAttachment) throw new Error("attachment disk full");
    this.importedPaths.push(...sourcePaths);
    const imported: AttachmentFile[] = [];
    for (const sourcePath of sourcePaths) {
      const fileName = sourcePath.split(/[\\/]/).pop() || "drop.png";
      const relativePath = attachmentRelativePath(fileName);
      const attachment: AttachmentFile = {
        relativePath,
        fileName,
        extension: fileName.split(".").pop() || "png",
        mimeType: mimeFromExtension(fileName.split(".").pop() || "png"),
        modifiedMs: Date.now(),
        size: 12,
      };
      this.attachments.set(relativePath, attachment);
      imported.push(attachment);
    }
    return imported;
  }

  async deleteAttachment(_root: string, relativePath: string) {
    if (this.failAttachment) throw new Error("attachment disk full");
    const attachment = this.attachments.get(relativePath);
    if (!attachment) {
      throw new GatewayError({ code: "not_found", message: "Mock attachment does not exist." });
    }
    const trashName = this.trashName(relativePath);
    this.attachments.delete(relativePath);
    this.trash.set(trashName, {
      trashName,
      originalPath: relativePath,
      trashPath: `.memoir-trash/${trashName}`,
      deletedAtMs: Date.now(),
      size: attachment.size,
      isAttachment: true,
    });
    this.trashContent.set(trashName, "");
    return `.memoir-trash/${trashName}`;
  }

  async openPath(_path: string) {}
  async revealPath(_path: string) {}
  async openExternal(_url?: string) {}
  linkPreviewHtml = new Map<string, string>();
  async fetchLinkPreviewHtml(url: string) {
    const html = this.linkPreviewHtml.get(url);
    if (html === undefined) {
      throw new GatewayError({ code: "not_found", message: "No link preview." });
    }
    return html;
  }
  resolveMediaPath(path: string) {
    return path;
  }

  nextExportPath: string | null = "/tmp/note.pdf";
  savedExports: Array<{ path: string; bytesBase64: string }> = [];

  async chooseExportPath({ defaultPath }: { defaultPath: string; title?: string }) {
    if (this.nextExportPath === null) return null;
    return this.nextExportPath || defaultPath;
  }

  async chooseExportFile({ defaultPath }: ExportDialogOptions) {
    if (this.nextExportPath === null) return null;
    return this.nextExportPath || defaultPath;
  }

  async writeExportFile(path: string, bytesBase64: string) {
    this.savedExports.push({ path, bytesBase64 });
  }

  savedTexts: Array<{ path: string; text: string; mime: string }> = [];

  async writeExportText(path: string, text: string, mime: string) {
    this.savedTexts.push({ path, text, mime });
  }

  private noteAt(relativePath: string): RawNoteFile {
    const content = this.files.get(relativePath) ?? "";
    const fileName = relativePath.split("/").pop() || relativePath;
    const parsed = parseNote(content, fileName);
    return {
      relativePath,
      fileName,
      extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
      modifiedMs: 1,
      size: content.length,
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
}

export class MockPersistenceGateway implements PersistenceGateway {
  state: AppState = {
    version: 1,
    preferences: DEFAULT_SETTINGS,
    recentWorkspaces: [],
    lastWorkspace: null,
    sidebarCollapsed: false,
    layout: DEFAULT_WORKSPACE_LAYOUT,
    favorites: {},
    folderAppearances: {},
  };
  drafts = new Map<string, string>();
  noteVersions = new Map<string, NoteVersion[]>();
  snapshotCalls: Array<{
    workspaceRoot: string;
    relativePath: string;
    oldContent: string;
    newContent: string;
    preserve: boolean;
  }> = [];
  failListVersions = false;
  failGetVersion = false;
  failSnapshot = false;
  nextUpdateCheck: AppUpdateCheck = {
    status: "upToDate",
    currentVersion: "0.0.0",
    latestVersion: "0.0.0",
    releaseUrl: null,
    releaseNotes: null,
  };
  checkAppUpdateCalls = 0;
  skipAppUpdateCalls: string[] = [];
  failCheck = false;

  async loadAppState() {
    return structuredClone(this.state);
  }

  async savePreferences(
    preferences: AppState["preferences"],
    lastWorkspace: string | null,
    sidebarCollapsed: boolean,
    layout?: WorkspaceLayoutState,
  ) {
    let recentWorkspaces = this.state.recentWorkspaces;
    if (lastWorkspace) {
      recentWorkspaces = [
        lastWorkspace,
        ...this.state.recentWorkspaces.filter((root) => root !== lastWorkspace),
      ].slice(0, 10);
    }
    this.state = {
      ...this.state,
      preferences,
      lastWorkspace,
      sidebarCollapsed,
      layout: layout ? mergeLayout(layout) : this.state.layout ?? DEFAULT_WORKSPACE_LAYOUT,
      recentWorkspaces,
    };
    return structuredClone(this.state);
  }

  async saveAiSessions(sessions: AiSessionRecord[], activeAiSessionId: string | null) {
    this.state = { ...this.state, aiSessions: sessions, activeAiSessionId };
  }

  async setFavorite(workspaceRoot: string, relativePath: string, favorite: boolean) {
    const values = new Set(this.state.favorites[workspaceRoot] || []);
    if (favorite) values.add(relativePath);
    else values.delete(relativePath);
    this.state.favorites[workspaceRoot] = [...values];
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
    return this.drafts.get(`${workspaceRoot}:${relativePath}`) ?? null;
  }

  async writeDraft(workspaceRoot: string, relativePath: string, content: string) {
    this.drafts.set(`${workspaceRoot}:${relativePath}`, content);
  }

  async deleteDraft(workspaceRoot: string, relativePath: string) {
    this.drafts.delete(`${workspaceRoot}:${relativePath}`);
  }

  async draftsExist(workspaceRoot: string, relativePaths: string[]) {
    return relativePaths.filter((relativePath) =>
      this.drafts.has(`${workspaceRoot}:${relativePath}`),
    );
  }

  async listNoteVersions(
    workspaceRoot: string,
    relativePath: string,
  ): Promise<NoteVersionMeta[]> {
    if (this.failListVersions) {
      throw new GatewayError({ code: "io", message: "Version list failed." });
    }
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
    if (this.failGetVersion) {
      throw new GatewayError({ code: "not_found", message: "Note version does not exist." });
    }
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
    this.snapshotCalls.push({ workspaceRoot, relativePath, oldContent, newContent, preserve });
    if (this.failSnapshot) {
      throw new GatewayError({ code: "io", message: "Snapshot failed." });
    }
  }

  private loadVersions(workspaceRoot: string, relativePath: string): NoteVersion[] {
    return this.noteVersions.get(`${workspaceRoot}:${relativePath}`) ?? [];
  }

  async migrateLegacyState() {
    return { migratedKeys: [] };
  }

  async checkAppUpdate() {
    this.checkAppUpdateCalls += 1;
    if (this.failCheck) {
      throw new GatewayError({
        code: "io",
        message: "No published GitHub release was found.",
        details: "HTTP 404",
      });
    }
    return structuredClone(this.nextUpdateCheck);
  }

  async skipAppUpdate(version: string) {
    this.skipAppUpdateCalls.push(version);
    this.state = { ...this.state, skippedUpdateVersion: version };
  }
}

export class MockCloudSyncGateway implements CloudSyncGateway {
  profiles = new Map<string, CloudSyncProfile>();
  lastTest: CloudSyncProfileInput | null = null;
  lastRun: { root: string; profile?: CloudSyncProfileInput } | null = null;
  failTest = false;
  failRun = false;
  runError: Error = new Error("sync failed");
  nextProbe: CloudSyncProbe = { ok: true, message: "Connected." };
  runHold: Promise<void> | null = null;
  runCalls = 0;
  progressListeners: Array<(progress: CloudSyncProgress) => void> = [];
  nextReport: CloudSyncReport = {
    uploaded: 1,
    downloaded: 0,
    deletedRemote: 0,
    deletedLocal: 0,
    skipped: 2,
    conflicts: 0,
    errors: [],
    completedMs: 1_700_000_000_000,
    durationMs: 8,
    changedLocalPaths: [],
  };

  async getProfile(workspaceRoot: string) {
    return mergeCloudSyncProfile(this.profiles.get(workspaceRoot) ?? defaultCloudSyncProfile());
  }

  async saveProfile(workspaceRoot: string, profile: CloudSyncProfileInput) {
    const current = await this.getProfile(workspaceRoot);
    const next = mergeCloudSyncProfile({ ...current, ...profile });
    this.profiles.set(workspaceRoot, next);
    return next;
  }

  async testConnection(profile: CloudSyncProfileInput) {
    this.lastTest = profile;
    if (this.failTest) throw new Error("unauthorized");
    return this.nextProbe;
  }

  async runSync(workspaceRoot: string, profile?: CloudSyncProfileInput): Promise<CloudSyncRunResult> {
    this.runCalls += 1;
    this.lastRun = { root: workspaceRoot, profile };
    if (this.runHold) await this.runHold;
    if (this.failRun) throw this.runError;
    if (profile) {
      await this.saveProfile(workspaceRoot, profile);
    }
    const saved = await this.getProfile(workspaceRoot);
    const next = mergeCloudSyncProfile({
      ...saved,
      lastSyncMs: this.nextReport.completedMs,
      lastStatus: "ok",
      lastError: null,
      lastReport: this.nextReport,
    });
    this.profiles.set(workspaceRoot, next);
    return { profile: next, report: this.nextReport };
  }

  async watchProgress(onProgress: (progress: CloudSyncProgress) => void) {
    this.progressListeners.push(onProgress);
    return () => {
      this.progressListeners = this.progressListeners.filter((listener) => listener !== onProgress);
    };
  }

  emitProgress(progress: CloudSyncProgress) {
    for (const listener of this.progressListeners) listener(progress);
  }
}

export class MockAiGateway implements AiGateway {
  /** Queue of canned replies; consumed one per chatCompletion call. */
  chatResponses: string[] = [
    "这是来自 MockAiGateway 的模拟回复。",
    "第二条模拟回复，用于连续对话测试。",
  ];
  chatCalls: Array<AiChatCompletionInput> = [];
  failChat = false;
  chatError = new GatewayError({ code: "io", message: "模拟 AI 请求失败。" });
  /** Reasoning pieces emitted before the content stream on streaming calls. */
  streamReasoning: string[] = ["思考过程"];
  /** Delay between streamed chunks (ms). */
  streamChunkDelayMs = 1;
  testCalls = 0;
  failTest = false;
  testError = new Error("模拟连接失败");
  nextTestResult = "AI 连接成功（模拟）。";

  async chatCompletion(input: AiChatCompletionInput): Promise<string> {
    this.chatCalls.push(input);
    if (this.failChat) throw this.chatError;
    const next = this.chatResponses.shift();
    if (next === undefined) {
      return `模拟回复 #${this.chatCalls.length}`;
    }
    return next;
  }

  async chatCompletionStream(
    input: AiChatCompletionInput,
    _requestId: string,
    onDelta: (piece: string) => void,
    onReasoning: (piece: string) => void,
  ): Promise<AiChatReply> {
    this.chatCalls.push(input);
    if (this.failChat) throw this.chatError;
    const next = this.chatResponses.shift();
    const content = next ?? `模拟回复 #${this.chatCalls.length}`;
    for (const piece of this.streamReasoning) {
      onReasoning(piece);
      await new Promise((resolve) => setTimeout(resolve, this.streamChunkDelayMs));
    }
    for (const piece of content.split("")) {
      onDelta(piece);
      await new Promise((resolve) => setTimeout(resolve, this.streamChunkDelayMs));
    }
    return { content, reasoning: this.streamReasoning.join("") };
  }

  async testConnection(): Promise<string> {
    this.testCalls += 1;
    if (this.failTest) throw this.testError;
    return this.nextTestResult;
  }
}

export function createMockGateways(): AppGateways & {
  workspace: MockWorkspaceGateway;
  persistence: MockPersistenceGateway;
  cloudSync: MockCloudSyncGateway;
  ai: MockAiGateway;
} {
  return {
    workspace: new MockWorkspaceGateway(),
    persistence: new MockPersistenceGateway(),
    cloudSync: new MockCloudSyncGateway(),
    ai: new MockAiGateway(),
  };
}
