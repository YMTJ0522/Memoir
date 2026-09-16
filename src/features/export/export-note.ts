import { mapGatewayError } from "../../domain/errors";
import { getGateways } from "../../gateways";
import type { ExportFormat } from "../../gateways/contracts";
import { resolveLocale } from "../../i18n/locale";
import { t, type MessageKey, type MessageParams } from "../../i18n/translate";
import { useAppStore } from "../../store/app-store";
import { parseNote } from "../library/note-utils";
import type { ExportOptions } from "./export-options";
import { DEFAULT_EXPORT_OPTIONS } from "./export-options";
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
  png: {
    dialog: "dialog.exportPng",
    exporting: "editor.exporting",
    exported: "status.exportedPng",
    failed: "errors.exportPng",
  },
  svg: {
    dialog: "dialog.exportSvg",
    exporting: "editor.exporting",
    exported: "status.exportedSvg",
    failed: "errors.exportSvg",
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

export async function exportNote(relativePath: string, format: ExportFormat, options?: Partial<ExportOptions>) {
  const opts: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options, format: format as ExportOptions["format"] };
  if (format === "pdf") return exportNotePdfFormat(relativePath, opts);
  if (format === "word") return exportNoteWordFormat(relativePath, opts);
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
        : htmlDocument(title, bodyHtml, languageTag, opts.template, opts.pageMargin);
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

/** PDF export uses the native print-to-PDF pipeline (vector, selectable text). */
export async function exportNotePdfFormat(relativePath: string, options?: Partial<ExportOptions>) {
  const opts: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options, format: "pdf" };
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
    await renderNotePdf({
      bodyFont: settings.appearance.bodyFont,
      content: resolved.content,
      locale: resolveLocale(settings.appearance.locale),
      note: resolved.note,
      relativePath,
      root: workspaceRoot,
      templateId: opts.template,
      pageMargin: opts.pageMargin,
      outputPath: chosen,
    });
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
export async function exportNoteWordFormat(relativePath: string, options?: Partial<ExportOptions>) {
  const opts: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options, format: "word" };
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
      templateId: opts.template,
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

/**
 * Batch-export multiple notes into a chosen directory.
 * Returns { succeeded, failed } counts.
 */
export async function exportNotesBatch(
  relativePaths: string[],
  format: ExportFormat,
  options?: Partial<ExportOptions>,
): Promise<{ succeeded: number; failed: number }> {
  if (relativePaths.length === 0) return { succeeded: 0, failed: 0 };
  const { workspaceRoot } = useAppStore.getState();
  if (!workspaceRoot) return { succeeded: 0, failed: relativePaths.length };

  const dir = await getGateways().workspace.chooseExportPath({
    defaultPath: workspaceRoot,
    title: currentT("dialog.exportBatch"),
  });
  if (!dir) return { succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  const total = relativePaths.length;

  for (let i = 0; i < relativePaths.length; i += 1) {
    const relativePath = relativePaths[i]!;
    useAppStore.setState({ status: currentT("editor.exportingBatch", { current: i + 1, total }) });
    try {
      // Resolve note content
      const resolved = await resolveNoteContent(relativePath);
      if (!resolved) {
        failed += 1;
        continue;
      }

      const { settings } = useAppStore.getState();
      const title = parseNote(resolved.content, resolved.note.fileName).title;
      const fileName = exportFileName(title, format);
      const targetPath = `${dir}/${fileName}`;

      if (format === "pdf" || format === "word") {
        if (format === "pdf") {
          await renderNotePdf({
            bodyFont: settings.appearance.bodyFont,
            content: resolved.content,
            locale: resolveLocale(settings.appearance.locale),
            note: resolved.note,
            relativePath,
            root: workspaceRoot,
            templateId: options?.template ?? "minimal",
            pageMargin: options?.pageMargin ?? "normal",
            outputPath: targetPath,
          });
        } else {
          const bytes = await renderNoteDocx({
            bodyFont: settings.appearance.bodyFont,
            content: resolved.content,
            locale: resolveLocale(settings.appearance.locale),
            note: resolved.note,
            relativePath,
            root: workspaceRoot,
            templateId: options?.template ?? "minimal",
          });
          await getGateways().workspace.writeExportFile(targetPath, bytesToBase64(bytes));
        }
      } else {
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
            : htmlDocument(title, bodyHtml, languageTag, options?.template ?? "minimal", options?.pageMargin ?? "normal");
        await getGateways().workspace.writeExportText(targetPath, text, "text/html;charset=utf-8");
      }
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  useAppStore.setState({
    status: currentT("status.exportedBatch", { succeeded, failed }),
  });
  return { succeeded, failed };
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
