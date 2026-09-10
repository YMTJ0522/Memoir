import type { FolderAppearance } from "./folders";
import type { WorkspaceLayoutState } from "./layout";
import type { AppSettings } from "./settings";
import type { AiSessionRecord } from "../gateways/contracts";

export const APP_STATE_VERSION = 1;

export type WindowFrameState = {
  width: number;
  height: number;
  maximized: boolean;
};

export type AppState = {
  version: number;
  preferences: AppSettings;
  recentWorkspaces: string[];
  lastWorkspace: string | null;
  sidebarCollapsed: boolean;
  layout?: WorkspaceLayoutState;
  favorites: Record<string, string[]>;
  folderAppearances: Record<string, Record<string, FolderAppearance>>;
  window?: WindowFrameState;
  skippedUpdateVersion?: string | null;
  /** Persisted AI chat sessions (chat history survives restarts). */
  aiSessions?: AiSessionRecord[];
  activeAiSessionId?: string | null;
};

export type LegacyStatePayload = {
  settings?: AppSettings;
  lastWorkspace?: string;
  sidebarCollapsed?: boolean;
  favorites?: string[];
  drafts: Array<{
    legacyKey: string;
    workspaceRoot?: string;
    relativePath?: string;
    content: string;
  }>;
};

export type MigrationResult = {
  migratedKeys: string[];
};
