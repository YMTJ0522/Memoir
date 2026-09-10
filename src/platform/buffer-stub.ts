/**
 * Minimal Buffer stub for browsers.
 *
 * gray-matter's `utils.toBuffer` calls `Buffer.from(String(input))` even on
 * the string-only path, and `Buffer` is Node-only, so frontmatter parsing
 * used to throw `ReferenceError: Buffer is not defined` in webviews. The
 * result is only stored as `file.orig` and never read back, so a tiny
 * stand-in is enough.
 *
 * IMPORTANT: This stub MUST stay minimal. The `docx` library (JSZip) probes
 * `typeof Buffer !== "undefined"` at module-evaluation time to decide between
 * its "nodebuffer" and pure-browser (uint8array) code paths. If a full
 * polyfill were installed, JSZip would take the nodebuffer path and produce
 * archives whose entry names are all empty (its Buffer.from() calls return
 * empty Uint8Arrays), which WPS cannot open. Memoir's Word export
 * (render-note-docx.tsx) additionally removes this stub before the first
 * dynamic import of "docx" so JSZip reliably picks the browser path, then
 * restores the stub for gray-matter afterwards.
 *
 * Node (tests) keeps its real Buffer because `globalThis.Buffer` is
 * already defined there.
 */
if (typeof globalThis.Buffer === "undefined") {
  (globalThis as Record<string, unknown>).Buffer = {
    from: () => new Uint8Array(0),
    isBuffer: () => false,
    concat: () => new Uint8Array(0),
  };
}

export {};
