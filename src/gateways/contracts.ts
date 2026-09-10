import type { AppState, LegacyStatePayload, MigrationResult } from "../domain/app-state";
import type { WorkspaceLayoutState } from "../domain/layout";
import type { AppUpdateCheck } from "../domain/app-update";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import type { WorkspaceIndexInfo } from "../domain/index-info";
import type { NoteGraph } from "../domain/note-links";
import type {
  LibraryPage,
  LibraryQuery,
  NoteExtension,
  NoteVersion,
  NoteVersionMeta,
  RawNoteFile,
  RenamedNote,
} from "../domain/notes";
import type { AppSettings } from "../domain/settings";
import type { TrashEntry } from "../domain/trash";
import type {
  CloudSyncProbe,
  CloudSyncProfile,
  CloudSyncProfileInput,
  CloudSyncProgress,
  CloudSyncRunResult,
} from "../domain/cloud-sync";

export type CreateNoteInput = {
  root: string;
  title: string;
  extension: NoteExtension;
  folder?: string;
  tags?: string[];
};

/** Raw payload of a local file chosen for article import. */
export type ImportSourcePayload = {
  fileName: string;
  extension: string;
  /** UTF-8/GBK-decoded text for txt/md/html sources. */
  text: string;
  /** Raw bytes (base64) — docx sources convert in the webview via mammoth. */
  bytesBase64: string;
};

export type ExportFormat = "pdf" | "html" | "markdown" | "word";

export interface ExportDialogOptions {
  defaultPath: string;
  title?: string;
  format: ExportFormat;
}

export const EXPORT_FILTERS: Record<ExportFormat, { name: string; extensions: string[]; mime: string }> = {
  pdf: { name: "PDF", extensions: ["pdf"], mime: "application/pdf" },
  html: { name: "HTML", extensions: ["html"], mime: "text/html;charset=utf-8" },
  markdown: { name: "Markdown", extensions: ["md"], mime: "text/markdown;charset=utf-8" },
  word: { name: "Word", extensions: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

export interface WorkspaceGateway {
  chooseWorkspace(title?: string): Promise<string | null>;
  reconcileWorkspace(root: string, query?: LibraryQuery): Promise<LibraryPage>;
  queryLibrary(root: string, query: LibraryQuery): Promise<LibraryPage>;
  getIndexInfo(root: string): Promise<WorkspaceIndexInfo>;
  getNoteGraph(root: string): Promise<NoteGraph>;
  rebuildIndex(root: string, query?: LibraryQuery): Promise<LibraryPage>;
  readNote(root: string, relativePath: string): Promise<string>;
  writeNote(root: string, relativePath: string, content: string): Promise<RawNoteFile>;
  createNote(input: CreateNoteInput): Promise<RawNoteFile>;
  /** Pick local article files (txt/md/html/docx), read + convert them. */
  importArticles(root: string): Promise<RawNoteFile[]>;
  /** Import articles from explicit paths (drag & drop reuses this path). */
  importArticlesFromPaths(root: string, sourcePaths: string[]): Promise<RawNoteFile[]>;
  renameNote(root: string, oldRelativePath: string, newRelativePath: string): Promise<RenamedNote>;
  deleteNote(root: string, relativePath: string): Promise<string>;
  /** Lists trash entries (soft-deleted notes & attachments). */
  listTrash(root: string): Promise<TrashEntry[]>;
  /** Restores a trash entry; resolves to the final restored relative path. */
  restoreTrashItem(root: string, trashName: string): Promise<string>;
  /** Permanently deletes one trash entry. */
  purgeTrashItem(root: string, trashName: string): Promise<void>;
  /** Permanently deletes every trash entry. */
  emptyTrash(root: string): Promise<void>;
  scanAttachments(root: string): Promise<AttachmentFile[]>;
  saveAttachment(root: string, input: SaveAttachmentInput): Promise<AttachmentFile>;
  importAttachments(root: string): Promise<AttachmentFile[]>;
  importAttachmentsFromPaths(root: string, sourcePaths: string[]): Promise<AttachmentFile[]>;
  deleteAttachment(root: string, relativePath: string): Promise<string>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  fetchLinkPreviewHtml(url: string): Promise<string>;
  resolveMediaPath(path: string): string;
  chooseExportPath(input: { defaultPath: string; title?: string }): Promise<string | null>;
  chooseExportFile(input: ExportDialogOptions): Promise<string | null>;
  writeExportFile(path: string, bytesBase64: string): Promise<void>;
  writeExportText(path: string, text: string, mime: string): Promise<void>;
}

/** One persisted AI chat message (used by saveAiSessions). */
export type AiMessageRecord = {
  id: string;
  role: string;
  content: string;
  reasoning?: string | null;
};

/** One persisted AI chat session (used by saveAiSessions). */
export type AiSessionRecord = {
  id: string;
  title: string;
  createdAt: number;
  messages: AiMessageRecord[];
};

export interface PersistenceGateway {
  loadAppState(): Promise<AppState>;
  savePreferences(
    preferences: AppSettings,
    lastWorkspace: string | null,
    sidebarCollapsed: boolean,
    layout?: WorkspaceLayoutState,
  ): Promise<AppState>;
  /** Persists AI chat sessions so they survive restarts. */
  saveAiSessions(
    sessions: AiSessionRecord[],
    activeAiSessionId: string | null,
  ): Promise<void>;
  setFavorite(workspaceRoot: string, relativePath: string, favorite: boolean): Promise<AppState>;
  setFolderAppearance(
    workspaceRoot: string,
    folder: string,
    appearance: FolderAppearance | null,
  ): Promise<AppState>;
  readDraft(workspaceRoot: string, relativePath: string): Promise<string | null>;
  writeDraft(workspaceRoot: string, relativePath: string, content: string): Promise<void>;
  deleteDraft(workspaceRoot: string, relativePath: string): Promise<void>;
  draftsExist(workspaceRoot: string, relativePaths: string[]): Promise<string[]>;
  listNoteVersions(workspaceRoot: string, relativePath: string): Promise<NoteVersionMeta[]>;
  getNoteVersion(workspaceRoot: string, relativePath: string, versionId: string): Promise<NoteVersion>;
  snapshotNoteVersion(
    workspaceRoot: string,
    relativePath: string,
    oldContent: string,
    newContent: string,
    preserve?: boolean,
  ): Promise<void>;
  migrateLegacyState(payload: LegacyStatePayload): Promise<MigrationResult>;
  checkAppUpdate(): Promise<AppUpdateCheck>;
  skipAppUpdate(version: string): Promise<void>;
}

export interface CloudSyncGateway {
  getProfile(workspaceRoot: string): Promise<CloudSyncProfile>;
  saveProfile(workspaceRoot: string, profile: CloudSyncProfileInput): Promise<CloudSyncProfile>;
  testConnection(profile: CloudSyncProfileInput): Promise<CloudSyncProbe>;
  runSync(workspaceRoot: string, profile?: CloudSyncProfileInput): Promise<CloudSyncRunResult>;
  watchProgress(onProgress: (progress: CloudSyncProgress) => void): Promise<() => void>;
}

/** One OpenAI-compatible chat message. */
export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Payload for an OpenAI-compatible chat completion request. */
export type AiChatCompletionInput = {
  messages: AiChatMessage[];
  temperature?: number;
};

/** Final combined reply of a streaming chat completion. */
export type AiChatReply = {
  content: string;
  reasoning: string;
};

export interface AiGateway {
  /** Sends a chat completion request and returns the assistant reply text. */
  chatCompletion(input: AiChatCompletionInput): Promise<string>;
  /**
   * Streams a chat completion. Calls `onDelta` for each visible content piece,
   * `onReasoning` for each thinking-trace piece, then resolves with the final
   * combined reply. Falls back to non-streaming when the runtime cannot stream.
   */
  chatCompletionStream(
    input: AiChatCompletionInput,
    requestId: string,
    onDelta: (piece: string) => void,
    onReasoning: (piece: string) => void,
  ): Promise<AiChatReply>;
  /** Validates the saved AI settings and probes the endpoint. */
  testConnection(): Promise<string>;
}

export type AppGateways = {
  workspace: WorkspaceGateway;
  persistence: PersistenceGateway;
  cloudSync: CloudSyncGateway;
  ai: AiGateway;
};
