import { exportNotePdfFormat } from "./export-note";

/**
 * Backwards-compatible entry point: PDF export now lives in export-note.ts
 * alongside the other formats. Kept so existing imports keep working.
 */
export async function exportNotePdf(relativePath: string) {
  return exportNotePdfFormat(relativePath);
}
