import { mapGatewayError } from "../../domain/errors";
import { getGateways } from "../../gateways";
import type { ExportFormat } from "../../gateways/contracts";
import { resolveLocale } from "../../i18n/locale";
import { t, type MessageKey, type MessageParams } from "../../i18n/translate";
import { useAppStore } from "../../store/app-store";
import { parseNote } from "../library/note-utils";
import { exportFileName, htmlDocument, markdownDocument } from "./export-document";
import { defaultExportPath } from "./pdf-file-name";
import { renderNoteDocx } from "./render-note-docx";
import { renderNoteHtmlBody } from "./render-note-html";
import { renderNotePdf } from "./render-note-pdf";

function currentT(key: MessageKey, params?: MessageParams) {
  return t(resolveLocale(useAppStore.getState().settings.appearance.locale), key, params);
}

const FORMAT_KEYS: Record<ExportFormat, { dialog: MessageKey; exporting: MessageKey; exported: MessageKey; failed: MessageKey }> = {
  pdf: {
    dialog: "dialog.exportPdf",
    exporting: "editor.exportingPdf",
    exported: "status.exportedPdf",
    failed: "errors.exportPdf",
  },
  html: {
    dialog: "dialog.exportHtml",
    exporting: "editor.exporting",
    exported: "status.exportedHtml",
    failed: "errors.exportHtml",
  },
  markdown: {
    dialog: "dialog.exportMarkdown",
    exporting: "editor.exporting",
    exported: "status.exportedMarkdown",
    failed: "errors.exportMarkdown",
  },
  word: {
    dialog: "dialog.exportWord",
    exporting: "editor.exporting",
    exported: "status.exportedWord",
    failed: "errors.exportWord",
  },
};

export async function resolveNoteContent(relativePath: string) {
  const state = useAppStore.getState();
  const note = state.notes.find((item) => item.relativePath === relativePath);
  if (!note || !state.workspaceRoot) return null;

  if (state.activePath === relativePath && state.loadedContentPath === relativePath) {
    return { content: state.content, note };
  }

  try {
    const draft = await getGateways().persistence.readDraft(state.workspaceRoot, relativePath);
    if (draft != null) return { content: draft, note };
  } catch {
    // Fall through to the file on disk.
  }

  const content = await getGateways().workspace.readNote(state.workspaceRoot, relativePath);
  return { content, note };
}

export async function exportNote(relativePath: string, format: ExportFormat) {
  if (format === "pdf") return exportNotePdfFormat(relativePath);
  if (format === "word") return exportNoteWordFormat(relativePath);
  const previousStatus = useAppStore.getState().status;
  const keys = FORMAT_KEYS[format];
  try {
    const resolved = await resolveNoteContent(relativePath);
    if (!resolved) {
      useAppStore.setState({ error: currentT(keys.failed, { message: currentT("dialog.currentNote") }) });
      return null;
    }

    const { settings, workspaceRoot } = useAppStore.getState();
    const title = parseNote(resolved.content, resolved.note.fileName).title;
    const fileName = exportFileName(title, format);
    const chosen = await getGateways().workspace.chooseExportFile({
      defaultPath: defaultExportPath(workspaceRoot, relativePath, fileName),
      title: currentT(keys.dialog),
      format,
    });
    if (!chosen) return null;

    useAppStore.setState({ error: "", status: currentT(keys.exporting) });
    const bodyHtml = await renderNoteHtmlBody({
      bodyFont: settings.appearance.bodyFont,
      content: resolved.content,
      locale: resolveLocale(settings.appearance.locale),
      note: resolved.note,
      relativePath,
      root: workspaceRoot,
    });
    const languageTag = resolveLocale(settings.appearance.locale) === "zh" ? "zh-CN" : "en";
    const text =
      format === "markdown"
        ? markdownDocument(title, resolved.content)
        : htmlDocument(title, bodyHtml, languageTag);
    await getGateways().workspace.writeExportText(chosen, text, "text/html;charset=utf-8");
    useAppStore.setState({ status: currentT(keys.exported) });
    return chosen;
  } catch (error) {
    useAppStore.setState({
      error: currentT(keys.failed, { message: mapGatewayError(error).message }),
      status: previousStatus,
    });
    return null;
  }
}

/** PDF export keeps the original dedicated flow (canvas render + binary write). */
export async function exportNotePdfFormat(relativePath: string) {
  const previousStatus = useAppStore.getState().status;
  const keys = FORMAT_KEYS.pdf;
  try {
    const resolved = await resolveNoteContent(relativePath);
    if (!resolved) {
      useAppStore.setState({ error: currentT(keys.failed, { message: currentT("dialog.currentNote") }) });
      return null;
    }

    const { settings, workspaceRoot } = useAppStore.getState();
    const title = parseNote(resolved.content, resolved.note.fileName).title;
    const fileName = exportFileName(title, "pdf");
    const chosen = await getGateways().workspace.chooseExportFile({
      defaultPath: defaultExportPath(workspaceRoot, relativePath, fileName),
      title: currentT(keys.dialog),
      format: "pdf",
    });
    if (!chosen) return null;

    useAppStore.setState({ error: "", status: currentT(keys.exporting) });
    const bytes = await renderNotePdf({
      bodyFont: settings.appearance.bodyFont,
      content: resolved.content,
      locale: resolveLocale(settings.appearance.locale),
      note: resolved.note,
      relativePath,
      root: workspaceRoot,
    });
    const bytesBase64 = bytesToBase64(bytes);
    await getGateways().workspace.writeExportFile(chosen, bytesBase64);
    useAppStore.setState({ status: currentT(keys.exported) });
    return chosen;
  } catch (error) {
    useAppStore.setState({
      error: currentT(keys.failed, { message: mapGatewayError(error).message }),
      status: previousStatus,
    });
    return null;
  }
}

/** Word export generates a true OOXML .docx via the docx library. */
export async function exportNoteWordFormat(relativePath: string) {
  const previousStatus = useAppStore.getState().status;
  const keys = FORMAT_KEYS.word;
  try {
    const resolved = await resolveNoteContent(relativePath);
    if (!resolved) {
      useAppStore.setState({ error: currentT(keys.failed, { message: currentT("dialog.currentNote") }) });
      return null;
    }

    const { settings, workspaceRoot } = useAppStore.getState();
    const title = parseNote(resolved.content, resolved.note.fileName).title;
    const fileName = exportFileName(title, "word");
    const chosen = await getGateways().workspace.chooseExportFile({
      defaultPath: defaultExportPath(workspaceRoot, relativePath, fileName),
      title: currentT(keys.dialog),
      format: "word",
    });
    if (!chosen) return null;

    useAppStore.setState({ error: "", status: currentT(keys.exporting) });
    const bytes = await renderNoteDocx({
      bodyFont: settings.appearance.bodyFont,
      content: resolved.content,
      locale: resolveLocale(settings.appearance.locale),
      note: resolved.note,
      relativePath,
      root: workspaceRoot,
    });
    const bytesBase64 = bytesToBase64(bytes);
    await getGateways().workspace.writeExportFile(chosen, bytesBase64);
    useAppStore.setState({ status: currentT(keys.exported) });
    return chosen;
  } catch (error) {
    useAppStore.setState({
      error: currentT(keys.failed, { message: mapGatewayError(error).message }),
      status: previousStatus,
    });
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array) {
  // Build a binary string from the byte array in chunks small enough to
  // avoid call-stack overflow, then base64-encode it.
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, index + chunkSize);
    const chunk = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) chunk[i] = slice[i];
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
