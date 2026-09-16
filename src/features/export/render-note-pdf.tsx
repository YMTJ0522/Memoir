import { invoke } from "@tauri-apps/api/core";
import type { NoteMeta } from "../../domain/notes";
import type { AppLocale, BodyFont } from "../../domain/settings";
import { isTauriRuntime } from "../../platform/runtime";
import { parseNote } from "../library/note-utils";
import type { ExportPageMargin, ExportTemplateId } from "./export-options";
import { htmlDocument } from "./export-document";
import { renderNoteHtmlBody } from "./render-note-html";

/**
 * Renders the note to a real vector PDF via the Tauri native print-to-PDF
 * pipeline. The output contains selectable/copyable text and stays sharp at
 * any zoom level (unlike the old html2canvas raster approach).
 *
 * In non-Tauri environments (browser tests / dev preview) this falls back to
 * a no-op so the call site does not crash.
 */
export async function renderNotePdf({
  root,
  relativePath,
  note,
  content,
  bodyFont,
  locale,
  templateId = "minimal",
  pageMargin = "normal",
  outputPath,
}: {
  root: string | null;
  relativePath: string;
  note: NoteMeta;
  content: string;
  bodyFont: BodyFont;
  locale: AppLocale;
  templateId?: ExportTemplateId;
  pageMargin?: ExportPageMargin;
  outputPath: string;
}): Promise<void> {
  // Render the note body through the preview pipeline (same as HTML export).
  const bodyHtml = await renderNoteHtmlBody({
    bodyFont,
    content,
    locale,
    note,
    relativePath,
    root,
  });

  const title = parseNote(content, note.fileName).title;
  const languageTag = locale === "zh" ? "zh-CN" : locale === "en" ? "en" : "zh-CN";

  // Build the complete self-contained HTML document (same as HTML export).
  const fullHtml = htmlDocument(title, bodyHtml, languageTag, templateId, pageMargin);

  if (!isTauriRuntime()) {
    // Browser / test environment: native print-to-PDF is unavailable.
    return;
  }

  await invoke("export_pdf", {
    html: fullHtml,
    outputPath,
  });
}
