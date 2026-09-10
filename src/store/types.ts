import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import type { TrashEntry } from "../domain/trash";
import type {
  LibraryStats,
  NoteExtension,
  NoteMeta,
  NavFilter,
  ScopedFilter,
} from "../domain/notes";
import type { AppSettings, ViewMode } from "../domain/settings";
import type {
  CloudSyncProbe,
  CloudSyncProfile,
  CloudSyncProfileInput,
  CloudSyncProgress,
  CloudSyncRunResult,
} from "../domain/cloud-sync";
import type { WorkspaceLayoutState } from "../domain/layout";
import type { SettingsSection } from "../features/settings/types";

export type WorkspaceSlice = {
  workspaceRoot: string | null;
  recentWorkspaces: string[];
  notes: NoteMeta[];
  libraryStats: LibraryStats;
  favoritePaths: string[];
  attachments: AttachmentFile[];
  trash: TrashEntry[];
  isLoading: boolean;
  folderAppearances: Record<string, FolderAppearance>;
};

export type DocumentSlice = {
  activePath: string | null;
  loadedContentPath: string | null;
  content: string;
  savedContent: string;
  isSaving: boolean;
};

export type LibraryPanelMode =
  | "notes"
  | "outline"
  | "links"
  | "attachments"
  | "index"
  | "sync"
  | "graph"
  | "ai"
  | "trash";

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "loading" | "error";
  error?: string;
  /** Thinking trace emitted by reasoning models (DeepSeek-R1 / Doubao thinking). */
  reasoning?: string;
};

export type AiSession = {
  id: string;
  title: string;
  createdAt: number;
  messages: AiChatMessage[];
};

export type LibrarySlice = {
  query: string;
  navFilter: NavFilter;
  scopedFilter: ScopedFilter;
  libraryPanelMode: LibraryPanelMode;
  aiSessions: AiSession[];
  activeAiSessionId: string | null;
};

export type SettingsSlice = {
  settings: AppSettings;
};

export type UiSlice = {
  initialized: boolean;
  status: string;
  error: string;
  viewMode: ViewMode;
  isSidebarCollapsed: boolean;
  layout: WorkspaceLayoutState;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  cloudSyncProfile: CloudSyncProfile;
  cloudSyncProgress: CloudSyncProgress | null;
  mobilePanel: "editor" | "library" | "navigation";
};

export type AppActions = {
  initialize(): Promise<void>;
  openWorkspace(root?: string): Promise<void>;
  refreshWorkspace(preferredPath?: string | null): Promise<void>;
  selectNote(relativePath: string): Promise<void>;
  setContent(content: string): void;
  saveActiveNote(): Promise<void>;
  createNote(input: {
    title: string;
    extension: NoteExtension;
    folder?: string;
    tags?: string[];
  }): Promise<void>;
  renameNote(relativePath: string, newRelativePath: string): Promise<void>;
  renameActiveNote(newRelativePath: string): Promise<void>;
  deleteNote(relativePath: string): Promise<void>;
  deleteActiveNote(): Promise<void>;
  restoreNoteVersion(versionId: string): Promise<void>;
  toggleFavorite(relativePath?: string): Promise<void>;
  setFolderAppearance(folder: string, appearance: FolderAppearance | null): Promise<void>;
  refreshAttachments(): Promise<void>;
  saveAttachments(inputs: SaveAttachmentInput[]): Promise<AttachmentFile[]>;
  savePastedImages(files: File[]): Promise<string>;
  importDroppedImages(sourcePaths: string[]): Promise<string>;
  importArticles(): Promise<void>;
  importAttachments(): Promise<AttachmentFile[]>;
  deleteAttachment(relativePath: string): Promise<void>;
  deleteAttachments(relativePaths: string[]): Promise<void>;
  refreshTrash(): Promise<void>;
  restoreTrashItem(trashName: string): Promise<void>;
  purgeTrashItem(trashName: string): Promise<void>;
  emptyTrash(): Promise<void>;
  rebuildIndex(): Promise<void>;
  setQuery(query: string): void;
  setNavFilter(navFilter: NavFilter): void;
  setScopedFilter(scopedFilter: ScopedFilter): void;
  setLibraryPanelMode(mode: LibrarySlice["libraryPanelMode"]): void;
  createAiSession(): string;
  selectAiSession(id: string): void;
  deleteAiSession(id: string): void;
  updateAiSession(id: string, patch: Partial<Pick<AiSession, "title" | "messages">>): void;
  setViewMode(mode: ViewMode): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setLayout(layout: Partial<WorkspaceLayoutState>): void;
  setSettings(settings: AppSettings): void;
  resetSettings(): void;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
  setSettingsSection(section: SettingsSection): void;
  saveCloudSyncProfile(profile: CloudSyncProfileInput): Promise<void>;
  testCloudSync(profile: CloudSyncProfileInput): Promise<CloudSyncProbe>;
  runCloudSync(profile?: CloudSyncProfileInput): Promise<CloudSyncRunResult | null>;
  setMobilePanel(panel: UiSlice["mobilePanel"]): void;
  clearError(): void;
};

export type AppStore = WorkspaceSlice &
  DocumentSlice &
  LibrarySlice &
  SettingsSlice &
  UiSlice &
  AppActions;
