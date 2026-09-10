import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdownForAttachments } from "../domain/attachments";
import { GatewayError } from "../domain/errors";
import { resolveLocale, t } from "../i18n";
import { AUTOSAVE_INTERVAL_MS, NOTE_METADATA_DEBOUNCE_MS, createAppStore } from "./app-store";
import { createMockGateways } from "../test/mock-gateways";

function translated(store: ReturnType<typeof createAppStore>, key: "status.draftRestored" | "status.saved") {
  return t(resolveLocale(store.getState().settings.appearance.locale), key);
}

describe("app store actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("manages AI sessions: create, switch, update, delete", () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);

    expect(store.getState().aiSessions).toEqual([]);
    const first = store.getState().createAiSession();
    expect(store.getState().aiSessions).toHaveLength(1);
    expect(store.getState().activeAiSessionId).toBe(first);

    const second = store.getState().createAiSession();
    expect(store.getState().aiSessions).toHaveLength(2);
    expect(store.getState().activeAiSessionId).toBe(second);

    store.getState().updateAiSession(first, {
      title: "第一问",
      messages: [{ id: "m1", role: "user", content: "第一问" }],
    });
    store.getState().selectAiSession(first);
    expect(store.getState().activeAiSessionId).toBe(first);
    expect(
      store.getState().aiSessions.find((session) => session.id === first)?.messages,
    ).toHaveLength(1);

    store.getState().deleteAiSession(first);
    expect(store.getState().aiSessions).toHaveLength(1);
    expect(store.getState().activeAiSessionId).toBe(second);
  });

  it("loads workspace, restores draft, edits and saves through gateways", async () => {
    const gateways = createMockGateways();
    gateways.persistence.drafts.set("/workspace:one.md", "# Draft");
    const store = createAppStore(gateways);

    await store.getState().openWorkspace("/workspace");
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Draft");
    expect(store.getState().status).toBe(translated(store, "status.draftRestored"));

    store.getState().setContent("# Edited");
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(gateways.persistence.drafts.get("/workspace:one.md")).toBe("# Edited");

    await store.getState().saveActiveNote();
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Edited" }]);
    expect(gateways.persistence.drafts.has("/workspace:one.md")).toBe(false);
    expect(store.getState().savedContent).toBe("# Edited");
  });

  it("keeps dirty content and exposes save failures", async () => {
    const gateways = createMockGateways();
    gateways.workspace.failWrite = true;
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Unsaved");

    await store.getState().saveActiveNote();
    expect(store.getState().savedContent).not.toBe("# Unsaved");
    expect(store.getState().content).toBe("# Unsaved");
    expect(store.getState().error).toContain("disk full");
  });

  it("updates favorites and CRUD state", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().toggleFavorite();
    expect(store.getState().notes[0].favorite).toBe(true);
    expect(gateways.persistence.state.favorites["/workspace"]).toEqual(["one.md"]);

    await store.getState().createNote({ title: "Second", extension: "mdx" });
    expect(store.getState().activePath).toBe("second.mdx");

    await store.getState().renameActiveNote("renamed.mdx");
    expect(store.getState().activePath).toBe("renamed.mdx");

    await store.getState().deleteActiveNote();
    expect(store.getState().notes.some((note) => note.relativePath === "renamed.mdx")).toBe(
      false,
    );
  });

  it("imports articles into the library and opens the last one", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const reconcilesAfterOpen = gateways.workspace.reconcileCount;

    gateways.workspace.nextImportedArticles = [
      { fileName: "想法.txt", content: "1. 第一条\n2. 第二条\n\n# 随想" },
      { fileName: "notes.html", content: "<h1>Web 文章</h1><p>正文</p>" },
    ];
await store.getState().importArticles();

    expect(gateways.workspace.reconcileCount).toBe(reconcilesAfterOpen);
    expect(store.getState().notes.some((note) => note.relativePath === "想法.md")).toBe(true);
    expect(store.getState().notes.some((note) => note.relativePath === "web-文章.md")).toBe(true);
    expect(store.getState().activePath).toBe("web-文章.md");
    expect(store.getState().status).toBe(
      t(resolveLocale(store.getState().settings.appearance.locale), "status.notesImported", {
        count: 2,
      }),
    );
  });

  it("surfaces article import failures", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    gateways.workspace.failWrite = true;
    await store.getState().importArticles();
    expect(store.getState().error).toContain("disk full");
  });

  it("rebuilds the workspace index then refreshes notes", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().rebuildIndex();
    expect(gateways.workspace.rebuildCount).toBe(1);
    expect(store.getState().error).toBe("");
    expect(store.getState().status).toBe(
      t(resolveLocale(store.getState().settings.appearance.locale), "status.indexRebuilt"),
    );

    gateways.workspace.failIndex = true;
    await store.getState().rebuildIndex();
    expect(store.getState().error).toContain("index locked");
  });

  it("saves and clears folder appearance for the current workspace", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().setFolderAppearance("日记", { emoji: "📔 日记", color: "coral" });
    expect(store.getState().folderAppearances).toEqual({
      日记: { emoji: "📔", color: "coral" },
    });
    expect(gateways.persistence.state.folderAppearances["/workspace"]).toEqual({
      日记: { emoji: "📔", color: "coral" },
    });

    await store.getState().setFolderAppearance("日记", null);
    expect(store.getState().folderAppearances).toEqual({});
    expect(gateways.persistence.state.folderAppearances["/workspace"]).toBeUndefined();
  });

  it("persists layout widths with preferences", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().initialize();
    store.getState().setLayout({ sidebarWidth: 200, libraryWidth: 320, editorSplit: 0.4 });
    expect(store.getState().layout).toEqual({
      sidebarWidth: 200,
      libraryWidth: 320,
      editorSplit: 0.4,
    });
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    expect(gateways.persistence.state.layout).toEqual({
      sidebarWidth: 200,
      libraryWidth: 320,
      editorSplit: 0.4,
    });
  });

  it("renames, favorites and deletes a note that is not active", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().createNote({ title: "Second", extension: "md" });
    await store.getState().selectNote("one.md");
    store.getState().setContent("# Keep editing");

    await store.getState().toggleFavorite("second.md");
    expect(store.getState().notes.find((note) => note.relativePath === "second.md")?.favorite).toBe(
      true,
    );
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Keep editing");

    await store.getState().renameNote("second.md", "kept.md");
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Keep editing");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(true);
    expect(gateways.persistence.state.favorites["/workspace"]).toEqual(["kept.md"]);

    await store.getState().deleteNote("kept.md");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(false);
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Keep editing");
  });

  it("switches views, persists settings and reports successful save state", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setViewMode("preview");
    expect(store.getState().viewMode).toBe("preview");

    store.getState().setSettings({
      ...store.getState().settings,
      editor: {
        ...store.getState().settings.editor,
        fontSize: 17,
      },
    });
    vi.advanceTimersByTime(350);
    await Promise.resolve();
    expect(gateways.persistence.state.preferences.editor.fontSize).toBe(17);

    store.getState().setContent("# Saved");
    await store.getState().saveActiveNote();
    expect(store.getState().status).toBe(translated(store, "status.saved"));
    expect(store.getState().isSaving).toBe(false);
  });

  it("autosaves an open dirty note every 3 seconds", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setContent("# Autosave me");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1);
    expect(gateways.workspace.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Autosave me" }]);
    expect(store.getState().savedContent).toBe("# Autosave me");
    expect(store.getState().status).toBe(translated(store, "status.saved"));
    expect(store.getState().notes[0].dirty).toBe(false);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(gateways.workspace.writes).toHaveLength(1);
  });

  it("autosaves the latest dirty content on the 3s cadence", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setContent("# A");
    await vi.advanceTimersByTimeAsync(1500);
    store.getState().setContent("# AB");
    await vi.advanceTimersByTimeAsync(1500);

    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# AB" }]);
  });

  it("autosaves a restored draft only while that note stays open", async () => {
    const gateways = createMockGateways();
    gateways.persistence.drafts.set("/workspace:one.md", "# Draft");
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Draft" }]);
    expect(gateways.persistence.drafts.has("/workspace:one.md")).toBe(false);
  });

  it("does not autosave after switching away from a dirty note", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().createNote({ title: "Second", extension: "md" });
    await store.getState().selectNote("one.md");

    store.getState().setContent("# Leave unsaved");
    await store.getState().selectNote("second.md");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);

    expect(gateways.workspace.writes).toEqual([]);
    expect(gateways.persistence.drafts.get("/workspace:one.md")).toBe("# Leave unsaved");
    expect(store.getState().savedContent).toBe("# Second");
  });

  it("does not apply a finished save to a different note", async () => {
    const gateways = createMockGateways();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const originalWrite = gateways.workspace.writeNote.bind(gateways.workspace);
    gateways.workspace.writeNote = async (root, path, content) => {
      await writeGate;
      return originalWrite(root, path, content);
    };

    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().createNote({ title: "Second", extension: "md" });
    await store.getState().selectNote("one.md");
    store.getState().setContent("# Old note");

    const savePromise = store.getState().saveActiveNote();
    await store.getState().selectNote("second.md");
    releaseWrite();
    await savePromise;

    expect(store.getState().activePath).toBe("second.md");
    expect(store.getState().content).toBe("# Second");
    expect(store.getState().savedContent).toBe("# Second");
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Old note" }]);
  });

  it("hydrates the library from scan metadata without reading every note", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("two.md", "# Two\n\nOther");
    gateways.persistence.drafts.set("/workspace:two.md", "# Draft Two");
    const readNote = vi.spyOn(gateways.workspace, "readNote");
    const readDraft = vi.spyOn(gateways.persistence, "readDraft");
    const store = createAppStore(gateways);

    await store.getState().openWorkspace("/workspace");

    expect(store.getState().notes.map((note) => note.relativePath).sort()).toEqual([
      "one.md",
      "two.md",
    ]);
    expect(store.getState().notes.find((note) => note.relativePath === "one.md")?.title).toBe("One");
    expect(store.getState().notes.find((note) => note.relativePath === "two.md")?.title).toBe(
      "Draft Two",
    );
    expect(store.getState().notes.find((note) => note.relativePath === "two.md")?.dirty).toBe(true);
    expect(readNote.mock.calls.map((call) => call[1])).toEqual(["one.md"]);
    expect(readDraft.mock.calls.map((call) => call[1]).sort()).toEqual(["one.md", "two.md"]);
  });

  it("keeps live editor metadata when reopening the current workspace", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Keep editing live");

    await store.getState().openWorkspace("/workspace");
    expect(store.getState().content).toBe("# Keep editing live");
    expect(store.getState().notes[0].title).toBe("Keep editing live");
    expect(store.getState().notes[0].dirty).toBe(true);
  });

  it("injects persisted favorites into the first reconcile and reports stats", async () => {
    const gateways = createMockGateways();
    gateways.persistence.state.lastWorkspace = "/workspace";
    gateways.persistence.state.favorites = { "/workspace": ["one.md"] };
    const reconcile = vi.spyOn(gateways.workspace, "reconcileWorkspace");
    const store = createAppStore(gateways);

    await store.getState().initialize();

    expect(reconcile).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ favoritePaths: ["one.md"] }),
    );
    expect(store.getState().libraryStats.favorites).toBe(1);
    expect(store.getState().notes.find((note) => note.relativePath === "one.md")?.favorite).toBe(
      true,
    );
  });

  it("scans the last workspace on startup", async () => {
    const gateways = createMockGateways();
    gateways.persistence.state.lastWorkspace = "/workspace";
    const reconcile = vi.spyOn(gateways.workspace, "reconcileWorkspace");
    const store = createAppStore(gateways);

    await store.getState().initialize();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("/workspace", expect.any(Object));
    expect(store.getState().workspaceRoot).toBe("/workspace");
    expect(store.getState().notes.map((note) => note.relativePath)).toEqual(["one.md"]);
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().initialized).toBe(true);
  });

  it("loads recent workspaces and keeps them when switching", async () => {
    const gateways = createMockGateways();
    gateways.persistence.state.lastWorkspace = "/workspace";
    gateways.persistence.state.recentWorkspaces = ["/workspace", "/archive"];
    const store = createAppStore(gateways);

    await store.getState().initialize();
    expect(store.getState().workspaceRoot).toBe("/workspace");
    expect(store.getState().recentWorkspaces).toEqual(["/workspace", "/archive"]);

    await store.getState().openWorkspace("/archive");
    expect(store.getState().workspaceRoot).toBe("/archive");
    expect(store.getState().recentWorkspaces).toEqual(["/archive", "/workspace"]);
  });

  it("flushes a dirty draft before switching workspaces", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Unsaved burst");

    await store.getState().openWorkspace("/archive");
    expect(gateways.persistence.drafts.get("/workspace:one.md")).toBe("# Unsaved burst");
    expect(store.getState().workspaceRoot).toBe("/archive");
    expect(store.getState().content).not.toBe("# Unsaved burst");
  });

  it("does not reset the editor when reopening the current workspace", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Keep editing");
    store.getState().setScopedFilter({ type: "folder", value: "日记" });

    await store.getState().openWorkspace("/workspace");
    expect(store.getState().content).toBe("# Keep editing");
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().scopedFilter).toEqual({ type: "folder", value: "日记" });
  });

  it("saves pasted images into the attachment library and returns note-relative markdown", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    const saved = await store.getState().saveAttachments([
      { bytesBase64: "AAAA", fileName: "paste-1.png", mimeType: "image/png" },
    ]);
    expect(saved[0]?.relativePath).toMatch(
      /^attachments\/\d{4}-\d{2}\/paste-1\.png$/,
    );
    expect(store.getState().attachments.map((item) => item.relativePath)).toEqual([
      saved[0]?.relativePath,
    ]);
    expect(markdownForAttachments("日记/today.md", saved)).toBe(
      `![paste-1](../${saved[0]?.relativePath})`,
    );

    await store.getState().deleteAttachment(saved[0]!.relativePath);
    expect(store.getState().attachments).toEqual([]);
  });

  it("deletes multiple attachments in one batch action", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    const saved = await store.getState().saveAttachments([
      { bytesBase64: "AAAA", fileName: "batch-1.png", mimeType: "image/png" },
      { bytesBase64: "BBBB", fileName: "batch-2.mp4", mimeType: "video/mp4" },
      { bytesBase64: "CCCC", fileName: "batch-3.png", mimeType: "image/png" },
    ]);
    expect(saved).toHaveLength(3);

    await store.getState().deleteAttachments([
      saved[0]!.relativePath,
      saved[2]!.relativePath,
    ]);
    expect(store.getState().attachments.map((item) => item.fileName)).toEqual(["batch-2.mp4"]);
    expect(store.getState().error).toBe("");

    // Deleting again with stale paths is a no-op that leaves state intact.
    await store.getState().deleteAttachments([saved[0]!.relativePath]);
    expect(store.getState().attachments).toHaveLength(1);
  });

  it("surfaces partial failures when batch deletion fails halfway", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const saved = await store.getState().saveAttachments([
      { bytesBase64: "AAAA", fileName: "fail-1.png", mimeType: "image/png" },
      { bytesBase64: "BBBB", fileName: "fail-2.png", mimeType: "image/png" },
    ]);

    gateways.workspace.failAttachment = true;
    await store.getState().deleteAttachments([saved[0]!.relativePath]);
    expect(store.getState().error.length).toBeGreaterThan(0);
    gateways.workspace.failAttachment = false;
  });

  it("requires an open note before pasting images", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.setState({ activePath: null, loadedContentPath: null, content: "", savedContent: "" });

    const markdown = await store.getState().savePastedImages([
      new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
    ]);
    expect(markdown).toBe("");
    expect(store.getState().error.length).toBeGreaterThan(0);
    expect(gateways.workspace.savedAttachments).toEqual([]);
  });

  it("imports dropped files including documents and rejects unknown types", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    const markdown = await store.getState().importDroppedImages([
      "/tmp/run.exe",
      "/home/me/Pictures/diagram.webp",
      "/home/me/Documents/报告.docx",
      "/home/me/Archives/打包.zip",
    ]);
    expect(gateways.workspace.importedPaths).toEqual([
      "/home/me/Pictures/diagram.webp",
      "/home/me/Documents/报告.docx",
      "/home/me/Archives/打包.zip",
    ]);
    expect(markdown).toContain("diagram.webp");
    // Documents and archives insert link syntax, media keeps embed syntax.
    expect(markdown).toContain("[报告.docx](attachments/");
    expect(markdown).toContain("[打包.zip](attachments/");
    expect(store.getState().attachments.some((item) => item.fileName === "diagram.webp")).toBe(
      true,
    );
    expect(store.getState().attachments.some((item) => item.fileName === "报告.docx")).toBe(true);
  });

  it("does not reconcile or scan attachments on create rename delete or save", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const reconcilesAfterOpen = gateways.workspace.reconcileCount;
    const attachmentsAfterOpen = gateways.workspace.scanAttachmentCount;
    const queryAfterOpen = gateways.workspace.queryLibraryCount;

    await store.getState().createNote({ title: "Second", extension: "md" });
    expect(store.getState().notes.some((note) => note.relativePath === "second.md")).toBe(true);
    expect(store.getState().notes.find((note) => note.relativePath === "second.md")?.title).toBe(
      "Second",
    );

    await store.getState().renameNote("second.md", "kept.md");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(true);

    await store.getState().deleteNote("kept.md");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(false);

    store.getState().setContent("# Saved locally");
    await store.getState().saveActiveNote();

    expect(gateways.workspace.reconcileCount).toBe(reconcilesAfterOpen);
    expect(gateways.workspace.scanAttachmentCount).toBe(attachmentsAfterOpen);
    expect(gateways.workspace.queryLibraryCount).toBeGreaterThan(queryAfterOpen);
    expect(store.getState().notes.find((note) => note.relativePath === "one.md")?.title).toBe(
      "Saved locally",
    );
  });

  it("rebuilds the index from the returned page without a follow-up reconcile", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const reconcilesAfterOpen = gateways.workspace.reconcileCount;

    await store.getState().rebuildIndex();
    expect(gateways.workspace.rebuildCount).toBe(1);
    expect(gateways.workspace.reconcileCount).toBe(reconcilesAfterOpen);
    expect(store.getState().notes.map((note) => note.relativePath)).toEqual(["one.md"]);
  });

  it("queries the library after filter changes without reconciling", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const reconcilesAfterOpen = gateways.workspace.reconcileCount;
    const queriesAfterOpen = gateways.workspace.queryLibraryCount;

    store.getState().setNavFilter("uncategorized");
    await Promise.resolve();
    await Promise.resolve();

    expect(gateways.workspace.reconcileCount).toBe(reconcilesAfterOpen);
    expect(gateways.workspace.queryLibraryCount).toBeGreaterThan(queriesAfterOpen);
  });

  it("saves and runs cloud sync through the gateway without a library walk", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });
    expect(store.getState().cloudSyncProfile.webdav.url).toBe("https://dav.example/dav");
    expect(store.getState().cloudSyncProfile.enabled).toBe(true);

    const reconciles = gateways.workspace.reconcileCount;
    await store.getState().runCloudSync();
    expect(gateways.cloudSync.lastRun).toEqual({ root: "/workspace", profile: undefined });
    expect(store.getState().cloudSyncProfile.lastStatus).toBe("ok");
    expect(store.getState().cloudSyncProfile.lastReport?.uploaded).toBe(1);
    expect(gateways.workspace.reconcileCount).toBe(reconciles);
  });

  it("completes cloud sync when the report omits changedLocalPaths", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });
    const { changedLocalPaths: _omitted, ...reportWithoutPaths } = gateways.cloudSync.nextReport;
    gateways.cloudSync.nextReport = reportWithoutPaths as typeof gateways.cloudSync.nextReport;

    await expect(store.getState().runCloudSync()).resolves.toMatchObject({
      report: { changedLocalPaths: [] },
    });
    expect(store.getState().error).toBe("");
    expect(store.getState().cloudSyncProfile.lastStatus).toBe("ok");
  });

  it("refreshes the library only when sync writes local files", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });
    const reconciles = gateways.workspace.reconcileCount;
    gateways.cloudSync.nextReport = {
      ...gateways.cloudSync.nextReport,
      uploaded: 0,
      downloaded: 1,
      changedLocalPaths: ["one.md"],
    };
    await store.getState().runCloudSync();
    expect(gateways.workspace.reconcileCount).toBe(reconciles + 1);
  });

  it("queues one trailing cloud sync when another run is already in flight", async () => {
    const gateways = createMockGateways();
    let release!: () => void;
    gateways.cloudSync.runHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });

    const first = store.getState().runCloudSync();
    await Promise.resolve();
    expect(gateways.cloudSync.runCalls).toBe(1);
    await expect(store.getState().runCloudSync()).resolves.toBeNull();
    expect(gateways.cloudSync.runCalls).toBe(1);
    release();
    await first;
    for (let i = 0; i < 20 && gateways.cloudSync.runCalls < 2; i += 1) {
      await Promise.resolve();
    }
    expect(gateways.cloudSync.runCalls).toBe(2);
  });

  it("shows a rate-limit message when the cloud provider throttles the run", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });
    gateways.cloudSync.failRun = true;
    gateways.cloudSync.runError = new GatewayError({
      code: "io",
      message: "The cloud service is temporarily rate-limited.",
      details: "HTTP 503 (rate limited)",
    });

    const locale = resolveLocale(store.getState().settings.appearance.locale);
    const expected = t(locale, "errors.runCloudSyncRateLimited");
    await expect(store.getState().runCloudSync()).rejects.toThrow();
    expect(store.getState().error).toBe(expected);
  });

  it("falls back to the rate-limit message when details are stripped", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });
    gateways.cloudSync.failRun = true;
    gateways.cloudSync.runError = new GatewayError({
      code: "io",
      message: "The cloud service is temporarily rate-limited.",
    });

    const locale = resolveLocale(store.getState().settings.appearance.locale);
    const expected = t(locale, "errors.runCloudSyncRateLimited");
    await expect(store.getState().runCloudSync()).rejects.toThrow();
    expect(store.getState().error).toBe(expected);
  });

  it("keeps the raw provider message for unrelated cloud sync failures", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });
    gateways.cloudSync.failRun = true;
    gateways.cloudSync.runError = new GatewayError({
      code: "io",
      message: "Remote folder was not found.",
      details: "HTTP 404",
    });

    const locale = resolveLocale(store.getState().settings.appearance.locale);
    const expected = t(locale, "errors.runCloudSync", {
      message: "Remote folder was not found.",
    });
    await expect(store.getState().runCloudSync()).rejects.toThrow();
    expect(store.getState().error).toBe(expected);
  });

  it("exposes live cloud sync progress while a run is in flight", async () => {
    const gateways = createMockGateways();
    let release!: () => void;
    gateways.cloudSync.runHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().saveCloudSyncProfile({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir",
      webdav: {
        url: "https://dav.example/dav",
        username: "ada",
        password: "secret",
        insecureTls: false,
      },
    });

    const first = store.getState().runCloudSync();
    await Promise.resolve();
    expect(store.getState().cloudSyncProgress).toEqual({
      phase: "scanning",
      path: null,
      action: null,
      current: 0,
      total: 0,
    });
    for (let i = 0; i < 10 && gateways.cloudSync.progressListeners.length === 0; i += 1) {
      await Promise.resolve();
    }
    gateways.cloudSync.emitProgress({
      phase: "working",
      path: "journal/day.md",
      action: "upload",
      current: 2,
      total: 8,
    });
    expect(store.getState().cloudSyncProgress).toMatchObject({
      phase: "working",
      path: "journal/day.md",
      current: 2,
      total: 8,
    });
    release();
    await first;
    expect(store.getState().cloudSyncProgress).toBeNull();
  });

  it("marks dirty on body-only edits without remapping title on every call", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const saved = store.getState().content;
    expect(store.getState().notes[0]?.title).toBe("One");

    store.getState().setContent(`${saved}!`);
    expect(store.getState().notes[0]?.title).toBe("One");
    expect(store.getState().notes[0]?.dirty).toBe(true);
    const afterDirty = store.getState().notes[0];

    store.getState().setContent(`${saved}!!`);
    store.getState().setContent(`${saved}!!!`);
    expect(store.getState().notes[0]).toBe(afterDirty);
    expect(store.getState().notes[0]?.title).toBe("One");

    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(gateways.persistence.drafts.get("/workspace:one.md")).toBe(`${saved}!!!`);
  });

  it("updates title after a heading change once metadata debounce elapses", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setContent("# Brand New\n\nBody");
    expect(store.getState().notes[0]?.title).toBe("One");
    expect(store.getState().notes[0]?.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(NOTE_METADATA_DEBOUNCE_MS);
    expect(store.getState().notes[0]?.title).toBe("Brand New");
  });

  it("updates title after a frontmatter change once metadata debounce elapses", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setContent("---\ntitle: Changed\ntags: [test]\n---\n\n# One\n\nOriginal");
    expect(store.getState().notes[0]?.title).toBe("One");
    await vi.advanceTimersByTimeAsync(NOTE_METADATA_DEBOUNCE_MS);
    expect(store.getState().notes[0]?.title).toBe("Changed");
  });

  it("lists drafts once for the current page instead of probing every path", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("two.md", "# Two");
    const draftsExist = vi.spyOn(gateways.persistence, "draftsExist");
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    expect(draftsExist).toHaveBeenCalledTimes(1);
    expect(draftsExist.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["one.md", "two.md"]));
  });

  it("snapshots the outgoing content before saving an edited note", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const original = gateways.workspace.files.get("one.md") ?? "";

    store.getState().setContent("# Edited");
    await store.getState().saveActiveNote();

    expect(gateways.persistence.snapshotCalls).toEqual([
      {
        workspaceRoot: "/workspace",
        relativePath: "one.md",
        oldContent: original,
        newContent: "# Edited",
        preserve: false,
      },
    ]);
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Edited" }]);
  });

  it("does not snapshot when the note is not dirty", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().saveActiveNote();
    expect(gateways.persistence.snapshotCalls).toEqual([]);
  });

  it("restores a version through an unconditional snapshot of the current content", async () => {
    const gateways = createMockGateways();
    gateways.persistence.noteVersions.set("/workspace:one.md", [
      {
        id: "v1",
        title: "One",
        size: 6,
        createdAt: 1_000,
        content: "# Older",
      },
    ]);
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setContent("# Edited");
    await store.getState().saveActiveNote();

    await store.getState().restoreNoteVersion("v1");

    expect(gateways.persistence.snapshotCalls.at(-1)).toMatchObject({
      relativePath: "one.md",
      oldContent: "# Edited",
      newContent: "# Older",
      preserve: true,
    });
    expect(gateways.workspace.writes.at(-1)).toEqual({ path: "one.md", content: "# Older" });
    expect(store.getState().content).toBe("# Older");
    expect(store.getState().savedContent).toBe("# Older");
    expect(gateways.persistence.drafts.has("/workspace:one.md")).toBe(false);
  });

  it("surfaces restore failures without changing the editor content", async () => {
    const gateways = createMockGateways();
    gateways.persistence.noteVersions.set("/workspace:one.md", [
      { id: "v1", title: "One", size: 6, createdAt: 1_000, content: "# Older" },
    ]);
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    gateways.persistence.failGetVersion = true;
    await store.getState().restoreNoteVersion("v1");

    expect(store.getState().content).toBe(gateways.workspace.files.get("one.md"));
    expect(store.getState().error).toBeTruthy();
  });

  it("moves deleted notes into the trash and restores them back into the library", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    const original = gateways.workspace.files.get("one.md");
    await store.getState().deleteActiveNote();
    expect(store.getState().notes.some((note) => note.relativePath === "one.md")).toBe(false);
    expect(gateways.workspace.trash.size).toBe(1);

    await store.getState().refreshTrash();
    expect(store.getState().trash).toHaveLength(1);
    const entry = store.getState().trash[0];
    expect(entry.originalPath).toBe("one.md");
    expect(entry.isAttachment).toBe(false);

    await store.getState().restoreTrashItem(entry.trashName);
    expect(store.getState().trash).toHaveLength(0);
    expect(store.getState().notes.some((note) => note.relativePath === "one.md")).toBe(true);
    expect(gateways.workspace.files.get("one.md")).toBe(original);
  });

  it("purges a single trash item and empties the trash on demand", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().deleteActiveNote();
    await store.getState().createNote({ title: "Two", extension: "md" });
    await store.getState().deleteActiveNote();
    await store.getState().refreshTrash();
    expect(store.getState().trash).toHaveLength(2);

    const [first] = store.getState().trash;
    await store.getState().purgeTrashItem(first.trashName);
    expect(store.getState().trash).toHaveLength(1);
    expect(gateways.workspace.trash.size).toBe(1);

    await store.getState().emptyTrash();
    expect(store.getState().trash).toHaveLength(0);
    expect(gateways.workspace.trash.size).toBe(0);
    expect(store.getState().status).toBe(
      t(resolveLocale(store.getState().settings.appearance.locale), "status.trashEmptied"),
    );
  });

  it("moves deleted attachments into the trash with the attachment flag", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    const [saved] = await store.getState().saveAttachments([
      { bytesBase64: "AAAA", fileName: "trash-attach.png", mimeType: "image/png" },
    ]);
    await store.getState().deleteAttachments([saved!.relativePath]);
    await store.getState().refreshTrash();

    const entry = store.getState().trash.find(
      (item) => item.originalPath === saved!.relativePath,
    );
    expect(entry?.isAttachment).toBe(true);

    await store.getState().restoreTrashItem(entry!.trashName);
    expect(
      store.getState().attachments.some((item) => item.relativePath === saved!.relativePath),
    ).toBe(true);
    expect(store.getState().trash).toHaveLength(0);
  });
});
