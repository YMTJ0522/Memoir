// Library refresh rules — do not put a full reconcile back on mutate paths:
// - initialize / openWorkspace / user refresh → reconcileWorkspace (the only walk).
// - createNote / renameNote / deleteNote / saveNote → never refreshWorkspace;
//   patch notes[] or queryLibrary (no walk).
// - rebuildIndex → consume the returned LibraryPage; do not reconcile again.
// - setQuery / setNavFilter / setScopedFilter → debounce queryLibrary, never reconcile.
// - notes[] is the current query page; libraryStats feeds the sidebar.
// - selectNote / unsaved overlay read by activePath, even if that path is absent from notes[].
import { create } from "zustand";
import type { AppGateways } from "../gateways/contracts";
import { getGateways } from "../gateways";
import {
  attachmentPathsFromDrop,
  fileToBase64,
  markdownForAttachments,
  maxAttachmentBytesForFile,
  suggestedPasteFileName,
  type AttachmentFile,
  type SaveAttachmentInput,
} from "../domain/attachments";
import { DEFAULT_WORKSPACE_LAYOUT, mergeLayout } from "../domain/layout";
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "../domain/settings";
import {
  cloudSyncChangedActiveNote,
  cloudSyncTouchedLocal,
  defaultCloudSyncProfile,
  initialCloudSyncProgress,
  mergeCloudSyncProfile,
  mergeCloudSyncReport,
  type CloudSyncProfileInput,
} from "../domain/cloud-sync";
import {
  folderAppearancesForWorkspace,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "../domain/folders";
import { mapGatewayError } from "../domain/errors";
import {
  emptyLibraryStats,
  libraryQueryFromFilters,
  type LibraryPage,
  type LibraryQuery,
  type NoteMeta,
  type RawNoteFile,
} from "../domain/notes";
import { flushLiveEditor } from "../domain/live-editor";
import { parseNote } from "../features/library/note-utils";
import { resolveLocale } from "../i18n/locale";
import { t, tc, type MessageKey, type MessageParams } from "../i18n/translate";
import type { AppStore, AiSession, AiChatMessage } from "./types";

function storeLocale(settings: AppSettings) {
  return resolveLocale(settings.appearance.locale);
}

function storeT(settings: AppSettings, key: MessageKey, params?: MessageParams) {
  return t(storeLocale(settings), key, params);
}

const PREFERENCES_DEBOUNCE_MS = 300;
const DRAFT_DEBOUNCE_MS = 450;
const QUERY_DEBOUNCE_MS = 150;
const CLOUD_SYNC_DEBOUNCE_MS = 15_000;
const CLOUD_SYNC_OPEN_DELAY_MS = 2_000;
const AI_SESSIONS_DEBOUNCE_MS = 400;
export const AUTOSAVE_INTERVAL_MS = 3000;
export const NOTE_METADATA_DEBOUNCE_MS = 80;

function sameLibraryFields(
  left: { title: string; tags: string[]; excerpt: string },
  right: { title: string; tags: string[]; excerpt: string },
) {
  return (
    left.title === right.title &&
    left.excerpt === right.excerpt &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

function isOpenUnsavedNote(state: {
  workspaceRoot: string | null;
  activePath: string | null;
  loadedContentPath: string | null;
  content: string;
  savedContent: string;
}) {
  return Boolean(
    state.workspaceRoot &&
      state.activePath &&
      state.loadedContentPath === state.activePath &&
      state.content !== state.savedContent,
  );
}

function favoriteSet(favorites: Record<string, string[]>, root: string) {
  return new Set(favorites[root] || []);
}

async function assembleNotes(
  gateways: AppGateways,
  root: string,
  files: RawNoteFile[],
  favorites: Set<string>,
  draftPaths: string[],
): Promise<NoteMeta[]> {
  const draftSet = new Set(draftPaths);
  return Promise.all(
    files.map(async (file): Promise<NoteMeta> => {
      const favorite = favorites.has(file.relativePath);
      if (!draftSet.has(file.relativePath)) {
        return { ...file, favorite, dirty: false };
      }
      try {
        const draft = await gateways.persistence.readDraft(root, file.relativePath);
        if (draft == null) {
          return { ...file, favorite, dirty: false };
        }
        const parsed = parseNote(draft, file.fileName);
        return { ...file, ...parsed, favorite, dirty: true };
      } catch {
        return {
          ...file,
          title: file.fileName.replace(/\.(md|mdx)$/i, ""),
          tags: [],
          excerpt: "",
          favorite,
        };
      }
    }),
  );
}

function toMessage(error: unknown) {
  return mapGatewayError(error).message;
}

function mergeAttachments(current: AttachmentFile[], incoming: AttachmentFile[]) {
  const next = new Map(current.map((item) => [item.relativePath, item]));
  for (const item of incoming) next.set(item.relativePath, item);
  return [...next.values()].sort(
    (left, right) => right.modifiedMs - left.modifiedMs || left.relativePath.localeCompare(right.relativePath),
  );
}

export function createAppStore(gateways: AppGateways = getGateways()) {
  let preferencesTimer: number | null = null;
  let draftTimer: number | null = null;
  let draftIdentity: string | null = null;
  let autosaveTimer: number | null = null;
  let queryTimer: number | null = null;
  let querySeq = 0;
  let cloudSyncTimer: number | null = null;
  let cloudSyncInFlight = false;
  let cloudSyncPending = false;
  let cloudSyncProgressWatch: Promise<void> | null = null;
  let metadataTimer: number | null = null;
  let metadataPath: string | null = null;
  let aiSessionsTimer: number | null = null;

  const store = create<AppStore>((set, get) => {
    const persistPreferences = () => {
      if (preferencesTimer !== null) window.clearTimeout(preferencesTimer);
      preferencesTimer = window.setTimeout(async () => {
        preferencesTimer = null;
        const state = get();
        try {
          await gateways.persistence.savePreferences(
            state.settings,
            state.workspaceRoot,
            state.isSidebarCollapsed,
            state.layout,
          );
        } catch (error) {
          set({
            error: storeT(state.settings, "errors.savePreferences", {
              message: toMessage(error),
            }),
          });
        }
      }, PREFERENCES_DEBOUNCE_MS);
    };

    const scheduleDraft = (root: string, relativePath: string, content: string, savedContent: string) => {
      if (draftTimer !== null) window.clearTimeout(draftTimer);
      draftIdentity = `${root}\0${relativePath}`;
      draftTimer = window.setTimeout(async () => {
        draftTimer = null;
        try {
          if (content === savedContent) {
            await gateways.persistence.deleteDraft(root, relativePath);
          } else {
            await gateways.persistence.writeDraft(root, relativePath, content);
          }
          if (draftIdentity === `${root}\0${relativePath}`) {
            set((state) => ({
              notes: state.notes.map((note) =>
                note.relativePath === relativePath
                  ? { ...note, dirty: content !== savedContent }
                  : note,
              ),
            }));
          }
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.saveDraft", { message: toMessage(error) }),
          });
        }
      }, DRAFT_DEBOUNCE_MS);
    };

    const scheduleNoteMetadata = (content: string, path: string | null, fileName: string | null) => {
      if (metadataTimer !== null) window.clearTimeout(metadataTimer);
      metadataPath = path;
      if (!path || !fileName) return;
      metadataTimer = window.setTimeout(() => {
        metadataTimer = null;
        const state = get();
        if (state.activePath !== path || metadataPath !== path) return;
        const active = state.notes.find((note) => note.relativePath === path);
        if (!active) return;
        const parsed = parseNote(content, fileName);
        const next = { title: parsed.title, tags: parsed.tags, excerpt: parsed.excerpt };
        if (sameLibraryFields(active, next)) return;
        set({
          notes: state.notes.map((note) =>
            note.relativePath === path ? { ...note, ...next } : note,
          ),
        });
      }, NOTE_METADATA_DEBOUNCE_MS);
    };

    const applyContentUpdate = (content: string) => {
      const state = get();
      const activeNote = state.notes.find((note) => note.relativePath === state.activePath);
      const dirty = content !== state.savedContent;
      const dirtyChanged = Boolean(activeNote && Boolean(activeNote.dirty) !== dirty);
      if (content !== state.content || dirtyChanged) {
        set({
          content,
          notes: dirtyChanged
            ? state.notes.map((note) =>
                note.relativePath === state.activePath ? { ...note, dirty } : note,
              )
            : state.notes,
        });
      }
      if (state.workspaceRoot && state.activePath && state.loadedContentPath === state.activePath) {
        scheduleDraft(state.workspaceRoot, state.activePath, content, state.savedContent);
      }
      scheduleNoteMetadata(content, state.activePath, activeNote?.fileName ?? null);
    };

    const syncLiveEditorContent = () => {
      const state = get();
      const latest = flushLiveEditor(state.activePath);
      if (latest == null || latest === state.content) return;
      applyContentUpdate(latest);
    };

    const scheduleCloudSync = (delayMs = CLOUD_SYNC_DEBOUNCE_MS) => {
      const state = get();
      if (!state.workspaceRoot || !state.cloudSyncProfile.enabled) return;
      if (cloudSyncInFlight) {
        cloudSyncPending = true;
        return;
      }
      if (cloudSyncTimer !== null) window.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = window.setTimeout(() => {
        cloudSyncTimer = null;
        void runScheduledCloudSync();
      }, delayMs);
    };

    const runScheduledCloudSync = async () => {
      const state = get();
      if (!state.workspaceRoot || !state.cloudSyncProfile.enabled) return;
      try {
        await get().runCloudSync();
      } catch {
        // runCloudSync already records the failure in `error`; scheduled runs
        // must not surface an unhandled promise rejection.
      }
    };

    const ensureCloudSyncProgressWatch = () => {
      if (cloudSyncProgressWatch) return;
      cloudSyncProgressWatch = gateways.cloudSync
        .watchProgress((progress) => {
          if (!cloudSyncInFlight) return;
          set({ cloudSyncProgress: progress });
        })
        .then(() => undefined)
        .catch(() => undefined);
    };

    const loadCloudSyncProfile = async (root: string | null) => {
      if (!root) {
        set({ cloudSyncProfile: defaultCloudSyncProfile() });
        return;
      }
      try {
        const profile = await gateways.cloudSync.getProfile(root);
        set({ cloudSyncProfile: mergeCloudSyncProfile(profile) });
      } catch {
        set({ cloudSyncProfile: defaultCloudSyncProfile() });
      }
    };

    const persistAiSessions = () => {
      if (aiSessionsTimer !== null) window.clearTimeout(aiSessionsTimer);
      aiSessionsTimer = window.setTimeout(async () => {
        aiSessionsTimer = null;
        const state = get();
        try {
          await gateways.persistence.saveAiSessions(
            state.aiSessions.map((session) => ({
              id: session.id,
              title: session.title,
              createdAt: session.createdAt,
              messages: session.messages.map((message) => ({
                id: message.id,
                role: message.role,
                content: message.content,
                reasoning: message.reasoning ?? null,
              })),
            })),
            state.activeAiSessionId,
          );
        } catch (error) {
          set({
            error: storeT(state.settings, "errors.saveAiSessions", {
              message: toMessage(error),
            }),
          });
        }
      }, AI_SESSIONS_DEBOUNCE_MS);
    };

    const currentQuery = (state = get()): LibraryQuery =>
      libraryQueryFromFilters(
        state.query,
        state.navFilter,
        state.scopedFilter,
        state.favoritePaths,
      );

    const applyLibraryPage = async (
      root: string,
      page: LibraryPage,
      preferredPath?: string | null,
      options?: { selectIfNeeded?: boolean; scanAttachments?: boolean },
    ) => {
      const appState = await gateways.persistence.loadAppState();
      const favorites = favoriteSet(appState.favorites, root);
      const favoritePaths = [...favorites];
      const draftPaths = await gateways.persistence.draftsExist(
        root,
        page.notes.map((file) => file.relativePath),
      );
      const notes = await assembleNotes(gateways, root, page.notes, favorites, draftPaths);
      const current = get();
      const overlaid = isOpenUnsavedNote(current)
        ? notes.map((note) =>
            note.relativePath === current.activePath
              ? {
                  ...note,
                  ...parseNote(current.content, note.fileName),
                  dirty: true,
                }
              : note,
          )
        : notes;
      const selectIfNeeded = options?.selectIfNeeded !== false;
      const preferred = preferredPath || null;
      const selected = selectIfNeeded
        ? (preferred ??
          (current.activePath &&
          (overlaid.some((note) => note.relativePath === current.activePath) ||
            current.loadedContentPath === current.activePath)
            ? current.activePath
            : null) ??
          overlaid[0]?.relativePath ??
          null)
        : current.activePath;
      const alreadyOpen = selected !== null && current.loadedContentPath === selected;
      set({
        notes: overlaid,
        libraryStats: page.stats,
        favoritePaths,
        folderAppearances: folderAppearancesForWorkspace(appState.folderAppearances, root),
        isLoading: false,
        status: tc(storeLocale(get().settings), "status.noteCount", page.stats.total),
        ...(selectIfNeeded ? { activePath: selected } : {}),
      });
      if (selectIfNeeded && selected && !alreadyOpen) await get().selectNote(selected);
    };

    const runLibraryQuery = async () => {
      const seq = ++querySeq;
      const state = get();
      const root = state.workspaceRoot;
      if (!root) return;
      try {
        const page = await gateways.workspace.queryLibrary(root, currentQuery(state));
        if (seq !== querySeq || get().workspaceRoot !== root) return;
        await applyLibraryPage(root, page, null, { selectIfNeeded: false });
      } catch (error) {
        if (seq !== querySeq) return;
        set({
          error: storeT(get().settings, "errors.refreshWorkspace", {
            message: toMessage(error),
          }),
        });
      }
    };

    const scheduleLibraryQuery = () => {
      if (queryTimer !== null) window.clearTimeout(queryTimer);
      queryTimer = window.setTimeout(() => {
        queryTimer = null;
        void runLibraryQuery();
      }, QUERY_DEBOUNCE_MS);
    };

    return {
      workspaceRoot: null,
      recentWorkspaces: [],
      notes: [],
      libraryStats: emptyLibraryStats(),
      favoritePaths: [],
      attachments: [],
      trash: [],
      isLoading: false,
      folderAppearances: {},
      activePath: null,
      loadedContentPath: null,
      content: "",
      savedContent: "",
      isSaving: false,
      query: "",
      navFilter: "all",
      scopedFilter: null,
      libraryPanelMode: "notes",
      aiSessions: [],
      activeAiSessionId: null,
      settings: DEFAULT_SETTINGS,
      initialized: false,
      status: storeT(DEFAULT_SETTINGS, "status.openFolder"),
      error: "",
      viewMode: DEFAULT_SETTINGS.editor.defaultView,
      isSidebarCollapsed: false,
      layout: DEFAULT_WORKSPACE_LAYOUT,
      settingsOpen: false,
      settingsSection: "appearance",
      cloudSyncProfile: defaultCloudSyncProfile(),
      cloudSyncProgress: null,
      mobilePanel: "editor",

      async initialize() {
        ensureCloudSyncProgressWatch();
        try {
          const appState = await gateways.persistence.loadAppState();
          const settings = mergeSettings(appState.preferences);
          const workspaceRoot = appState.lastWorkspace;
          set({
            settings,
            viewMode: settings.editor.defaultView,
            workspaceRoot,
            recentWorkspaces: appState.recentWorkspaces,
            isSidebarCollapsed: appState.sidebarCollapsed,
            layout: mergeLayout(appState.layout),
            favoritePaths: workspaceRoot
              ? [...favoriteSet(appState.favorites, workspaceRoot)]
              : [],
            folderAppearances: workspaceRoot
              ? folderAppearancesForWorkspace(appState.folderAppearances, workspaceRoot)
              : {},
            aiSessions: (appState.aiSessions ?? []).map((session) => ({
              id: session.id,
              title: session.title,
              createdAt: session.createdAt,
              messages: session.messages.flatMap((message) => {
                if (message.role !== "user" && message.role !== "assistant") return [];
                const narrowed: AiChatMessage = {
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  reasoning: message.reasoning ?? undefined,
                };
                return [narrowed];
              }),
            })),
            activeAiSessionId: appState.activeAiSessionId ?? null,
          });
          if (workspaceRoot) {
            await loadCloudSyncProfile(workspaceRoot);
            await get().refreshWorkspace();
            scheduleCloudSync(CLOUD_SYNC_OPEN_DELAY_MS);
          }
          set({ initialized: true });
        } catch (error) {
          set({
            initialized: true,
            error: storeT(get().settings, "errors.loadAppState", { message: toMessage(error) }),
          });
        }
      },

      async openWorkspace(root) {
        syncLiveEditorContent();
        const current = get();
        if (isOpenUnsavedNote(current) && current.workspaceRoot && current.activePath) {
          try {
            await gateways.persistence.writeDraft(
              current.workspaceRoot,
              current.activePath,
              current.content,
            );
          } catch {
            // Switching still proceeds; only this unsaved burst may be lost.
          }
        }
        if (draftTimer !== null) {
          window.clearTimeout(draftTimer);
          draftTimer = null;
        }
        draftIdentity = null;

        set({ isLoading: true, error: "" });
        try {
          const selectedRoot =
            root ??
            (await gateways.workspace.chooseWorkspace(
              storeT(get().settings, "workspace.chooseFolder"),
            ));
          if (!selectedRoot) {
            set({ isLoading: false });
            return;
          }
          const persistedState = await gateways.persistence.savePreferences(
            get().settings,
            selectedRoot,
            get().isSidebarCollapsed,
            get().layout,
          );
          const workspaceRoot = persistedState.lastWorkspace || selectedRoot;
          const recentWorkspaces = persistedState.recentWorkspaces.length
            ? persistedState.recentWorkspaces
            : [workspaceRoot];
          if (workspaceRoot === get().workspaceRoot) {
            set({ recentWorkspaces });
            await loadCloudSyncProfile(workspaceRoot);
            await get().refreshWorkspace();
            scheduleCloudSync(CLOUD_SYNC_OPEN_DELAY_MS);
            return;
          }
          set({
            workspaceRoot,
            recentWorkspaces,
            favoritePaths: [...favoriteSet(persistedState.favorites, workspaceRoot)],
            folderAppearances: folderAppearancesForWorkspace(
              persistedState.folderAppearances,
              workspaceRoot,
            ),
            attachments: [],
            activePath: null,
            loadedContentPath: null,
            content: "",
            savedContent: "",
            query: "",
            navFilter: "all",
            scopedFilter: null,
            libraryPanelMode: "notes",
          });
          await loadCloudSyncProfile(workspaceRoot);
          await get().refreshWorkspace();
          scheduleCloudSync(CLOUD_SYNC_OPEN_DELAY_MS);
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.openWorkspace", { message: toMessage(error) }),
          });
        }
      },

      // Reconcile is the only walk: initialize, openWorkspace, and explicit refresh.
      // Mutate paths (create/rename/delete/save) and filter changes must not call this.
      async refreshWorkspace(preferredPath) {
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const [page, attachments, trash] = await Promise.all([
            gateways.workspace.reconcileWorkspace(root, currentQuery()),
            gateways.workspace.scanAttachments(root),
            gateways.workspace.listTrash(root).catch(() => []),
          ]);
          set({ attachments, trash });
          await applyLibraryPage(root, page, preferredPath);
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.refreshWorkspace", {
              message: toMessage(error),
            }),
          });
        }
      },

      async selectNote(relativePath) {
        syncLiveEditorContent();
        const root = get().workspaceRoot;
        if (!root) return;
        set({
          activePath: relativePath,
          isLoading: true,
          error: "",
          mobilePanel: "editor",
          isSaving: false,
        });
        try {
          const [savedContent, draft] = await Promise.all([
            gateways.workspace.readNote(root, relativePath),
            gateways.persistence.readDraft(root, relativePath),
          ]);
          if (get().activePath !== relativePath) return;
          set({
            content: draft ?? savedContent,
            savedContent,
            loadedContentPath: relativePath,
            isLoading: false,
            status:
              draft !== null && draft !== savedContent
                ? storeT(get().settings, "status.draftRestored")
                : storeT(get().settings, "status.loaded"),
          });
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.loadNote", { message: toMessage(error) }),
          });
        }
      },

      setContent(content) {
        applyContentUpdate(content);
      },

      async saveActiveNote() {
        syncLiveEditorContent();
        const { workspaceRoot, activePath, content, savedContent, loadedContentPath, isSaving } =
          get();
        if (!workspaceRoot || !activePath || loadedContentPath !== activePath || isSaving) return;
        const saveRoot = workspaceRoot;
        const savePath = activePath;
        const saveContent = content;
        const outgoingContent = savedContent;
        set({ isSaving: true, error: "" });
        try {
          if (outgoingContent && outgoingContent !== saveContent) {
            await gateways.persistence.snapshotNoteVersion(
              saveRoot,
              savePath,
              outgoingContent,
              saveContent,
            );
          }
          await gateways.workspace.writeNote(saveRoot, savePath, saveContent);
          await gateways.persistence.deleteDraft(saveRoot, savePath);
          set((state) => {
            if (state.workspaceRoot !== saveRoot || state.activePath !== savePath) {
              return { isSaving: false };
            }
            const stillDirty = state.content !== saveContent;
            return {
              isSaving: false,
              savedContent: saveContent,
              status: stillDirty ? state.status : storeT(state.settings, "status.saved"),
              notes: state.notes.map((note) =>
                note.relativePath === savePath
                  ? {
                      ...note,
                      ...parseNote(saveContent, note.fileName),
                      modifiedMs: Date.now(),
                      dirty: stillDirty,
                    }
                  : note,
              ),
            };
          });
          scheduleCloudSync();
        } catch (error) {
          set((state) => ({
            isSaving: state.activePath === savePath ? false : state.isSaving,
            error: storeT(state.settings, "errors.saveNote", { message: toMessage(error) }),
          }));
        }
      },

      async createNote(input) {
        syncLiveEditorContent();
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const created = await gateways.workspace.createNote({ root, ...input });
          const page = await gateways.workspace.queryLibrary(root, currentQuery());
          await applyLibraryPage(root, page, created.relativePath);
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.createNote", { message: toMessage(error) }),
          });
        }
      },

      async renameNote(relativePath, newRelativePath) {
        syncLiveEditorContent();
        const { workspaceRoot, activePath, content, savedContent, notes } = get();
        const trimmed = newRelativePath.trim();
        if (!workspaceRoot || !relativePath || !trimmed || relativePath === trimmed) return;
        set({ isLoading: true, error: "" });
        try {
          const renamed = await gateways.workspace.renameNote(
            workspaceRoot,
            relativePath,
            trimmed,
          );
          const note = notes.find((item) => item.relativePath === relativePath);
          const draft = await gateways.persistence.readDraft(workspaceRoot, relativePath);
          const nextDraft =
            relativePath === activePath && content !== savedContent ? content : draft;
          await gateways.persistence.deleteDraft(workspaceRoot, relativePath);
          if (nextDraft !== null) {
            await gateways.persistence.writeDraft(workspaceRoot, renamed.note.relativePath, nextDraft);
          }
          const favoritePaths = get().favoritePaths.includes(relativePath)
            || Boolean(note?.favorite)
            ? [
                ...get().favoritePaths.filter((path) => path !== relativePath),
                renamed.note.relativePath,
              ]
            : get().favoritePaths;
          if (note?.favorite || get().favoritePaths.includes(relativePath)) {
            await gateways.persistence.setFavorite(workspaceRoot, relativePath, false);
            await gateways.persistence.setFavorite(workspaceRoot, renamed.note.relativePath, true);
          }
          const wasActive = relativePath === activePath;
          if (wasActive) {
            set({
              activePath: renamed.note.relativePath,
              loadedContentPath: renamed.note.relativePath,
              favoritePaths,
            });
          } else {
            set({ favoritePaths });
          }
          const page = await gateways.workspace.queryLibrary(workspaceRoot, currentQuery());
          await applyLibraryPage(
            workspaceRoot,
            page,
            wasActive ? renamed.note.relativePath : undefined,
            { selectIfNeeded: wasActive },
          );
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.renameNote", { message: toMessage(error) }),
          });
        }
      },

      async renameActiveNote(newRelativePath) {
        const { activePath } = get();
        if (!activePath) return;
        await get().renameNote(activePath, newRelativePath);
      },

      async deleteNote(relativePath) {
        syncLiveEditorContent();
        const { workspaceRoot, activePath, notes } = get();
        if (!workspaceRoot || !relativePath) return;
        set({ isLoading: true, error: "" });
        try {
          const note = notes.find((item) => item.relativePath === relativePath);
          await gateways.workspace.deleteNote(workspaceRoot, relativePath);
          await gateways.persistence.deleteDraft(workspaceRoot, relativePath);
          if (note?.favorite) {
            await gateways.persistence.setFavorite(workspaceRoot, relativePath, false);
          }
          const nextFavorites = get().favoritePaths.filter((path) => path !== relativePath);
          if (relativePath === activePath) {
            set({
              activePath: null,
              loadedContentPath: null,
              content: "",
              savedContent: "",
              favoritePaths: nextFavorites,
            });
          } else {
            set({ favoritePaths: nextFavorites });
          }
          const page = await gateways.workspace.queryLibrary(workspaceRoot, currentQuery());
          await applyLibraryPage(workspaceRoot, page, null, { selectIfNeeded: relativePath === activePath });
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.deleteNote", { message: toMessage(error) }),
          });
        }
      },

      async deleteActiveNote() {
        const { activePath } = get();
        if (!activePath) return;
        await get().deleteNote(activePath);
      },

      async restoreNoteVersion(versionId) {
        syncLiveEditorContent();
        const { workspaceRoot, activePath, savedContent, loadedContentPath } = get();
        if (!workspaceRoot || !activePath || loadedContentPath !== activePath) return;
        try {
          const version = await gateways.persistence.getNoteVersion(
            workspaceRoot,
            activePath,
            versionId,
          );
          if (savedContent) {
            await gateways.persistence.snapshotNoteVersion(
              workspaceRoot,
              activePath,
              savedContent,
              version.content,
              true,
            );
          }
          const updated = await gateways.workspace.writeNote(
            workspaceRoot,
            activePath,
            version.content,
          );
          await gateways.persistence.deleteDraft(workspaceRoot, activePath);
          set((state) => {
            const isActive = state.activePath === activePath;
            return {
              content: isActive ? version.content : state.content,
              savedContent: isActive ? version.content : state.savedContent,
              loadedContentPath: isActive ? activePath : state.loadedContentPath,
              status: storeT(state.settings, "status.versionRestored"),
              notes: state.notes.map((note) =>
                note.relativePath === activePath
                  ? {
                      ...note,
                      ...parseNote(version.content, note.fileName),
                      modifiedMs: updated.modifiedMs,
                    }
                  : note,
              ),
            };
          });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.restoreVersion", {
              message: toMessage(error),
            }),
          });
        }
      },

      async setFolderAppearance(folder, appearance) {
        const { workspaceRoot, folderAppearances } = get();
        if (!workspaceRoot) return;
        const key = normalizeFolderKey(folder);
        const nextAppearance = appearance ? normalizeFolderAppearance(appearance) : undefined;
        const next = { ...folderAppearances };
        if (nextAppearance) next[key] = nextAppearance;
        else delete next[key];
        set({ folderAppearances: next });
        try {
          const state = await gateways.persistence.setFolderAppearance(
            workspaceRoot,
            key,
            nextAppearance ?? null,
          );
          set({
            folderAppearances: folderAppearancesForWorkspace(state.folderAppearances, workspaceRoot),
          });
        } catch (error) {
          set({
            folderAppearances,
            error: storeT(get().settings, "errors.saveFolderAppearance", {
              message: toMessage(error),
            }),
          });
        }
      },

      async toggleFavorite(relativePath) {
        const { workspaceRoot, activePath, notes, favoritePaths, libraryStats, navFilter } = get();
        const path = relativePath ?? activePath;
        if (!workspaceRoot || !path) return;
        const favorite = !favoritePaths.includes(path);
        const nextFavorites = favorite
          ? [...favoritePaths, path]
          : favoritePaths.filter((item) => item !== path);
        set({
          favoritePaths: nextFavorites,
          notes: notes.map((item) =>
            item.relativePath === path ? { ...item, favorite } : item,
          ),
          libraryStats: {
            ...libraryStats,
            favorites: Math.max(0, libraryStats.favorites + (favorite ? 1 : -1)),
          },
        });
        try {
          await gateways.persistence.setFavorite(workspaceRoot, path, favorite);
          if (navFilter === "favorites") await runLibraryQuery();
        } catch (error) {
          set({
            notes,
            favoritePaths,
            libraryStats,
            error: storeT(get().settings, "errors.saveFavorite", { message: toMessage(error) }),
          });
        }
      },

      async refreshAttachments() {
        const root = get().workspaceRoot;
        if (!root) {
          set({ attachments: [] });
          return;
        }
        try {
          set({ attachments: await gateways.workspace.scanAttachments(root) });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.loadAttachments", { message: toMessage(error) }),
          });
        }
      },

      async saveAttachments(inputs: SaveAttachmentInput[]) {
        const root = get().workspaceRoot;
        if (!root || inputs.length === 0) return [];
        try {
          const saved: AttachmentFile[] = [];
          for (const input of inputs) {
            saved.push(await gateways.workspace.saveAttachment(root, input));
          }
          set({
            attachments: mergeAttachments(get().attachments, saved),
            status: storeT(get().settings, "status.attachmentSaved"),
            error: "",
          });
          scheduleCloudSync();
          return saved;
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.saveAttachment", { message: toMessage(error) }),
          });
          return [];
        }
      },

      async savePastedImages(files: File[]) {
        const { workspaceRoot, activePath, settings } = get();
        if (!workspaceRoot) return "";
        if (!activePath) {
          set({ error: storeT(settings, "errors.pasteNeedsNote") });
          return "";
        }
        const oversized = files.find((file) => file.size > maxAttachmentBytesForFile(file));
        if (oversized) {
          set({ error: storeT(settings, "errors.attachmentTooLarge") });
          return "";
        }
        const inputs = await Promise.all(
          files.map(async (file) => ({
            bytesBase64: await fileToBase64(file),
            fileName: suggestedPasteFileName(file),
            mimeType: file.type,
          })),
        );
        const saved = await get().saveAttachments(inputs);
        return markdownForAttachments(get().activePath, saved);
      },

      async importDroppedImages(sourcePaths) {
        const { workspaceRoot, activePath, settings } = get();
        const paths = attachmentPathsFromDrop(sourcePaths);
        if (!workspaceRoot || paths.length === 0) return "";
        if (!activePath) {
          set({ error: storeT(settings, "errors.pasteNeedsNote") });
          return "";
        }
        try {
          const imported = await gateways.workspace.importAttachmentsFromPaths(
            workspaceRoot,
            paths,
          );
          if (!imported.length) return "";
          set({
            attachments: mergeAttachments(get().attachments, imported),
            status: storeT(get().settings, "status.attachmentSaved"),
            error: "",
          });
          return markdownForAttachments(get().activePath, imported);
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.importAttachment", { message: toMessage(error) }),
          });
          return "";
        }
      },

      async importAttachments() {
        const root = get().workspaceRoot;
        if (!root) return [];
        try {
          const imported = await gateways.workspace.importAttachments(root);
          if (imported.length) {
            set({
              attachments: mergeAttachments(get().attachments, imported),
              status: storeT(get().settings, "status.attachmentsImported"),
              error: "",
            });
          }
          return imported;
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.importAttachment", { message: toMessage(error) }),
          });
          return [];
        }
      },

      async importArticles() {
        syncLiveEditorContent();
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const imported = await gateways.workspace.importArticles(root);
          if (!imported.length) {
            set({ isLoading: false });
            return;
          }
          const page = await gateways.workspace.queryLibrary(root, currentQuery());
          const lastPath = imported[imported.length - 1].relativePath;
          await applyLibraryPage(root, page, lastPath);
          set({
            status: storeT(get().settings, "status.notesImported", { count: imported.length }),
          });
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.importNote", { message: toMessage(error) }),
          });
        }
      },

      async deleteAttachment(relativePath) {
        const root = get().workspaceRoot;
        if (!root || !relativePath) return;
        try {
          await gateways.workspace.deleteAttachment(root, relativePath);
          set({
            attachments: get().attachments.filter((item) => item.relativePath !== relativePath),
            status: storeT(get().settings, "status.attachmentDeleted"),
            error: "",
          });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.deleteAttachment", { message: toMessage(error) }),
          });
        }
      },

      async deleteAttachments(relativePaths) {
        const root = get().workspaceRoot;
        const paths = [...new Set(relativePaths)].filter(Boolean);
        if (!root || paths.length === 0) return;
        const failed: string[] = [];
        const deleted: string[] = [];
        for (const relativePath of paths) {
          try {
            await gateways.workspace.deleteAttachment(root, relativePath);
            deleted.push(relativePath);
          } catch {
            failed.push(relativePath);
          }
        }
        if (deleted.length) {
          const removed = new Set(deleted);
          set({
            attachments: get().attachments.filter((item) => !removed.has(item.relativePath)),
            status: storeT(get().settings, "status.attachmentsDeleted", { count: deleted.length }),
            error: "",
          });
        }
        if (failed.length) {
          set({
            error: storeT(get().settings, "errors.deleteAttachment", {
              message: storeT(get().settings, "errors.attachmentsPartialDelete", {
                count: failed.length,
              }),
            }),
          });
        }
      },

      async refreshTrash() {
        const root = get().workspaceRoot;
        if (!root) {
          set({ trash: [] });
          return;
        }
        try {
          set({ trash: await gateways.workspace.listTrash(root) });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.loadTrash", { message: toMessage(error) }),
          });
        }
      },

      async restoreTrashItem(trashName) {
        const root = get().workspaceRoot;
        if (!root || !trashName) return;
        try {
          const restoredPath = await gateways.workspace.restoreTrashItem(root, trashName);
          set({
            trash: get().trash.filter((entry) => entry.trashName !== trashName),
            status: storeT(get().settings, "status.trashRestored"),
            error: "",
          });
          // The note is back on disk; refresh the library so it shows up.
          await get().refreshWorkspace(restoredPath);
          await get().refreshAttachments();
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.restoreTrash", { message: toMessage(error) }),
          });
        }
      },

      async purgeTrashItem(trashName) {
        const root = get().workspaceRoot;
        if (!root || !trashName) return;
        try {
          await gateways.workspace.purgeTrashItem(root, trashName);
          set({
            trash: get().trash.filter((entry) => entry.trashName !== trashName),
            status: storeT(get().settings, "status.trashPurged"),
            error: "",
          });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.purgeTrash", { message: toMessage(error) }),
          });
        }
      },

      async emptyTrash() {
        const root = get().workspaceRoot;
        if (!root) return;
        try {
          await gateways.workspace.emptyTrash(root);
          set({
            trash: [],
            status: storeT(get().settings, "status.trashEmptied"),
            error: "",
          });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.emptyTrash", { message: toMessage(error) }),
          });
        }
      },

      async rebuildIndex() {
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const page = await gateways.workspace.rebuildIndex(root, currentQuery());
          await applyLibraryPage(root, page);
          set({ status: storeT(get().settings, "status.indexRebuilt") });
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.rebuildIndex", { message: toMessage(error) }),
          });
        }
      },

      setQuery(query) {
        set({ query });
        scheduleLibraryQuery();
      },
      setNavFilter(navFilter) {
        set({ navFilter, scopedFilter: null, mobilePanel: "library", libraryPanelMode: "notes" });
        void runLibraryQuery();
      },
      setScopedFilter(scopedFilter) {
        set({ scopedFilter, navFilter: "all", mobilePanel: "library", libraryPanelMode: "notes" });
        void runLibraryQuery();
      },
      setLibraryPanelMode(libraryPanelMode) {
        const isMainArea = libraryPanelMode === "graph";
        set({
          libraryPanelMode,
          mobilePanel: isMainArea ? "editor" : "library",
        });
      },
      createAiSession() {
        const id = `ai-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const session: AiSession = {
          id,
          title: storeT(get().settings, "ai.newChat"),
          createdAt: Date.now(),
          messages: [],
        };
        set((state) => ({
          aiSessions: [...state.aiSessions, session],
          activeAiSessionId: id,
        }));
        persistAiSessions();
        return id;
      },
      selectAiSession(id) {
        set({ activeAiSessionId: id });
        persistAiSessions();
      },
      deleteAiSession(id) {
        set((state) => {
          const sessions = state.aiSessions.filter((session) => session.id !== id);
          const activeAiSessionId =
            state.activeAiSessionId === id
              ? (sessions.at(-1)?.id ?? null)
              : state.activeAiSessionId;
          return { aiSessions: sessions, activeAiSessionId };
        });
        persistAiSessions();
      },
      updateAiSession(id, patch) {
        set((state) => ({
          aiSessions: state.aiSessions.map((session) =>
            session.id === id ? { ...session, ...patch } : session,
          ),
        }));
        persistAiSessions();
      },
      setViewMode(viewMode) {
        set({ viewMode });
      },
      setSidebarCollapsed(isSidebarCollapsed) {
        set({ isSidebarCollapsed });
        persistPreferences();
      },
      setLayout(partial) {
        const layout = mergeLayout({ ...get().layout, ...partial });
        const current = get().layout;
        if (
          layout.sidebarWidth === current.sidebarWidth &&
          layout.libraryWidth === current.libraryWidth &&
          layout.editorSplit === current.editorSplit
        ) {
          return;
        }
        set({ layout });
        persistPreferences();
      },
      setSettings(settings) {
        set({ settings: mergeSettings(settings) });
        persistPreferences();
      },
      resetSettings() {
        set({ settings: DEFAULT_SETTINGS });
        persistPreferences();
      },
      openSettings(settingsSection = "appearance") {
        set({ settingsOpen: true, settingsSection });
      },
      closeSettings() {
        set({ settingsOpen: false });
      },
      setSettingsSection(settingsSection) {
        set({ settingsSection });
      },
      async saveCloudSyncProfile(profile: CloudSyncProfileInput) {
        const root = get().workspaceRoot;
        if (!root) return;
        try {
          const saved = await gateways.cloudSync.saveProfile(root, profile);
          set({
            cloudSyncProfile: mergeCloudSyncProfile(saved),
            status: storeT(get().settings, "status.cloudSyncSaved"),
          });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.saveCloudSync", { message: toMessage(error) }),
          });
          throw error;
        }
      },
      async testCloudSync(profile: CloudSyncProfileInput) {
        return gateways.cloudSync.testConnection(profile);
      },
      async runCloudSync(profile?: CloudSyncProfileInput) {
        const root = get().workspaceRoot;
        if (!root) return null;
        if (cloudSyncInFlight) {
          cloudSyncPending = true;
          return null;
        }
        ensureCloudSyncProgressWatch();
        cloudSyncInFlight = true;
        set({ cloudSyncProgress: initialCloudSyncProgress() });
        const unsaved = isOpenUnsavedNote(get());
        const activePath = get().activePath;
        try {
          const result = await gateways.cloudSync.runSync(root, profile);
          const report = mergeCloudSyncReport(result.report) ?? result.report;
          set({
            cloudSyncProfile: mergeCloudSyncProfile(result.profile),
            status: storeT(get().settings, "status.cloudSyncComplete"),
          });
          if (cloudSyncTouchedLocal(report)) {
            await get().refreshWorkspace();
          }
          if (
            !unsaved &&
            activePath &&
            get().activePath === activePath &&
            cloudSyncChangedActiveNote(report, activePath)
          ) {
            await get().selectNote(activePath);
          }
          return { ...result, report };
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.runCloudSync", { message: toMessage(error) }),
          });
          throw error;
        } finally {
          cloudSyncInFlight = false;
          set({ cloudSyncProgress: null });
          if (cloudSyncPending) {
            cloudSyncPending = false;
            void get().runCloudSync().catch(() => {
              // Failure is already surfaced via the `error` state above.
            });
          }
        }
      },
      setMobilePanel(mobilePanel) {
        set({ mobilePanel });
      },
      clearError() {
        set({ error: "" });
      },
    };
  });

  const stopAutosave = () => {
    if (autosaveTimer !== null) {
      window.clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
  };

  const syncAutosave = () => {
    if (!isOpenUnsavedNote(store.getState())) {
      stopAutosave();
      return;
    }
    if (autosaveTimer !== null) return;
    autosaveTimer = window.setInterval(() => {
      const state = store.getState();
      if (!isOpenUnsavedNote(state)) {
        stopAutosave();
        return;
      }
      if (state.isSaving) return;
      void state.saveActiveNote();
    }, AUTOSAVE_INTERVAL_MS);
  };

  store.subscribe(syncAutosave);
  return store;
}

export const useAppStore = createAppStore();
