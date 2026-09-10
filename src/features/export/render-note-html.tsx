import type { NoteMeta } from "../../domain/notes";
import type { BodyFont } from "../../domain/settings";
import { getGateways } from "../../gateways";
import {
  decodeMediaHref,
  noteDirectory,
  resolveWorkspaceFilePath,
} from "../../domain/paths";
import { I18nProvider } from "../../i18n/react";
import type { AppLocale } from "../../domain/settings";
import { createRoot } from "react-dom/client";
import { parseNote } from "../library/note-utils";
import { NotePreviewArticle } from "../preview/NotePreviewArticle";

const EXPORT_WIDTH_PX = 794;

async function waitForPreviewReady(host: HTMLElement, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const article = host.querySelector("article");
    const pending =
      !article ||
      host.querySelector("[data-mdx-pending]") ||
      host.querySelector("[data-mermaid-pending]") ||
      host.querySelector("[data-link-card-pending]");
    const imagesPending = [...host.querySelectorAll("img")].some((image) => !image.complete);
    if (article && !pending && !imagesPending) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
}

/**
 * Reads workspace images referenced by exported HTML and converts them into
 * data URLs so the exported document is fully self-contained (inkstone
 * inlinePrivateImages parity).
 */
async function inlineWorkspaceImages(host: HTMLElement, root: string, relativePath: string) {
  const directory = noteDirectory(relativePath);
  const images = [...host.querySelectorAll<HTMLImageElement>("img")];
  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute("src") || "";
      if (/^(https?:|data:|blob:)/i.test(src)) return;
      try {
        const resolved = resolveWorkspaceFilePath(root, directory, decodeMediaHref(src));
        const url = getGateways().workspace.resolveMediaPath(resolved);
        const response = await fetch(url);
        if (!response.ok) return;
        const dataUrl = await blobToDataUrl(await response.blob());
        if (dataUrl) image.setAttribute("src", dataUrl);
      } catch {
        // Keep the original reference when the file cannot be read.
      }
    }),
  );
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * Renders a note through the live preview pipeline (same remark/rehype
 * plugins as on-screen preview) and returns the rendered body HTML with
 * workspace images inlined as data URLs.
 */
export async function renderNoteHtmlBody({
  root,
  relativePath,
  note,
  content,
  bodyFont,
  locale,
}: {
  root: string | null;
  relativePath: string;
  note: NoteMeta;
  content: string;
  bodyFont: BodyFont;
  locale: AppLocale;
}): Promise<string> {
  const host = document.createElement("div");
  host.className = "memoir-pdf-export";
  host.dataset.bodyFont = bodyFont;
  host.dataset.theme = "light";
  host.style.width = `${EXPORT_WIDTH_PX}px`;
  document.body.append(host);

  const reactRoot = createRoot(host);
  try {
    reactRoot.render(
      <I18nProvider locale={locale}>
        <NotePreviewArticle
          className="memoir-preview memoir-pdf-preview prose prose-neutral"
          compileDelay={0}
          content={content}
          note={note}
          relativePath={relativePath}
          root={root}
        />
      </I18nProvider>,
    );
    await waitForPreviewReady(host);
    const article = host.querySelector("article");
    // Layout metrics (scrollHeight) are 0 in jsdom — a non-empty DOM tree is
    // proof of a successful render for both the browser and tests.
    if (!(article instanceof HTMLElement) || !article.textContent?.trim()) {
      throw new Error("Preview did not render.");
    }
    if (root) {
      await inlineWorkspaceImages(article, root, relativePath);
    }
    return article.innerHTML;
  } finally {
    reactRoot.unmount();
    host.remove();
  }
}

export function noteTitleOf(content: string, fileName: string) {
  return parseNote(content, fileName).title;
}
