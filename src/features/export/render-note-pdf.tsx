import type { NoteMeta } from "../../domain/notes";
import type { AppLocale, BodyFont } from "../../domain/settings";
import { parseNote } from "../library/note-utils";
import { htmlDocument } from "./export-document";
import { renderNoteHtmlBody } from "./render-note-html";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const EXPORT_WIDTH_PX = 794;

/** px per A4 page at the export width (794px ≙ 210mm). */
const PAGE_HEIGHT_PX = Math.round((EXPORT_WIDTH_PX * A4_HEIGHT_MM) / A4_WIDTH_MM);

/** Moving a keep-together block to the next page is only worth it while the
 * gap it leaves is small. Beyond this share of a page, splitting the block
 * at its inner line/row boundaries (code, tables) reads better than a big
 * blank area. */
const MAX_MOVE_WASTE_PX = Math.round(PAGE_HEIGHT_PX * 0.3);

/** Hard cap for a single canvas pass. */
const MAX_SLICE_HEIGHT_PX = 12000;

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const SPLITTABLE_SELECTOR = "pre, .memoir-code-block, table";

interface BlockInfo {
  el: HTMLElement;
  top: number;
  bottom: number;
  height: number;
}

function measureBlocks(element: HTMLElement): BlockInfo[] {
  const top = element.getBoundingClientRect().top;
  return [...element.children]
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .map((child) => {
      const rect = child.getBoundingClientRect();
      return { el: child, top: rect.top - top, bottom: rect.bottom - top, height: rect.height };
    })
    .filter((block) => block.height > 0);
}

function isKeepTogetherBlock(node: Node): boolean {
  return (
    node instanceof HTMLElement &&
    node.matches(
      "h1, h2, h3, h4, h5, h6, table, .memoir-code-block, pre, img, .callout, aside[data-callout], .memoir-wiki-embed, hr",
    )
  );
}

function collectBreakCandidates(element: HTMLElement, blocks: BlockInfo[]): number[] {
  const elementTop = element.getBoundingClientRect().top;
  const boundaries: number[] = [];
  const pushTop = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    if (rect.height > 0) boundaries.push(rect.top - elementTop);
  };
  const pushBottom = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    if (rect.height > 0) boundaries.push(rect.bottom - elementTop);
  };
  for (const { el: block } of blocks) {
    pushTop(block);
    pushBottom(block);
    if (block.matches("pre, .memoir-code-block")) {
      const lineSpans = block.querySelectorAll<HTMLElement>(".line");
      if (lineSpans.length > 1) {
        for (const line of lineSpans) pushBottom(line);
      } else {
        const code = block.querySelector("code");
        if (code) {
          const range = document.createRange();
          range.selectNodeContents(code);
          for (const rect of range.getClientRects()) {
            if (rect.height > 0) boundaries.push(rect.bottom - elementTop);
          }
        }
      }
      continue;
    }
    if (block.matches("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dd, dt, figcaption")) {
      const range = document.createRange();
      range.selectNodeContents(block);
      for (const rect of range.getClientRects()) {
        if (rect.height > 0) boundaries.push(rect.bottom - elementTop);
      }
      continue;
    }
    const rows = [...block.querySelectorAll<HTMLElement>("tr, li")];
    if (rows.length > 1) for (const row of rows) pushBottom(row);
  }
  boundaries.push(element.scrollHeight);
  return [...new Set(boundaries.filter((value) => value >= 0))].sort((a, b) => a - b);
}

function computePageBreaks(element: HTMLElement): number[] {
  const blocks = measureBlocks(element);
  const candidates = collectBreakCandidates(element, blocks);
  const totalHeight = element.scrollHeight;
  const breaks: number[] = [];
  let pageStart = 0;

  while (pageStart < totalHeight - 1) {
    const limit = pageStart + PAGE_HEIGHT_PX;
    let next = pageStart;
    for (const boundary of candidates) {
      if (boundary > limit) break;
      if (boundary > pageStart) next = boundary;
    }
    if (next <= pageStart) next = limit;

    next = applyKeepRules(next, pageStart, limit, blocks);
    if (next <= pageStart) next = limit;
    breaks.push(next);
    pageStart = next;
  }
  return breaks;
}

function blockEndingAt(blocks: BlockInfo[], next: number): BlockInfo | null {
  const containing = blocks.find((b) => b.top < next - 2 && b.bottom > next - 2);
  if (containing) return containing;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]!.bottom <= next + 4) return blocks[index]!;
  }
  return null;
}

function applyKeepRules(
  breakAt: number,
  pageStart: number,
  limit: number,
  blocks: BlockInfo[],
): number {
  let next = breakAt;
  for (let pass = 0; pass < 8; pass += 1) {
    const container = blocks.find((b) => next > b.top + 2 && next < b.bottom - 2);
    if (container && isKeepTogetherBlock(container.el)) {
      const waste = limit - container.top;
      const splittable = container.el.matches(SPLITTABLE_SELECTOR);
      const canMove = container.height <= PAGE_HEIGHT_PX && container.top > pageStart + 2;
      const tooBigToMove = container.height > PAGE_HEIGHT_PX * 0.4;
      const preferSplit = splittable && (tooBigToMove || waste > MAX_MOVE_WASTE_PX);
      if (canMove && !preferSplit) {
        next = container.top;
        continue;
      }
    }

    const ending = blockEndingAt(blocks, next);
    if (ending && ending.el.matches(HEADING_SELECTOR) && ending.top > pageStart + 2) {
      next = ending.top;
      continue;
    }
    break;
  }
  return next;
}

/**
 * Renders the HTML document (same as HTML export) inside a hidden iframe so
 * the exported PDF visually matches the exported HTML — same CSS, fonts,
 * heading colours, table zebra stripes, callout backgrounds, code block
 * styling, etc.
 */
async function renderHtmlInIframe(fullHtml: string): Promise<HTMLElement> {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-99999px";
  iframe.style.top = "0";
  iframe.style.width = `${EXPORT_WIDTH_PX + 40}px`; // body padding margin
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.style.background = "#fff";
  document.body.append(iframe);

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(fullHtml);
  doc.close();

  // Wait for images + fonts to load inside the iframe.
  await new Promise<void>((resolve) => {
    const check = () => {
      const body = iframe.contentDocument?.body;
      if (!body) return;
      const imgs = [...body.querySelectorAll("img")];
      const allLoaded = imgs.every((img) => img.complete);
      if (allLoaded) resolve();
      else setTimeout(check, 50);
    };
    check();
  });

  // Give the browser one more frame to settle layout.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const body = iframe.contentDocument!.body;
  body.style.width = `${EXPORT_WIDTH_PX}px`;
  body.style.margin = "0";
  body.style.padding = "2.5rem 1.75rem";

  return body;
}

async function elementToPdfBytes(element: HTMLElement, title: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);
  const pdf = new jsPDF({ compress: true, format: "a4", orientation: "portrait", unit: "mm" });
  pdf.setProperties({ creator: "Memoir", title });

  const totalHeight = Math.max(element.scrollHeight, 1);
  const breaks = computePageBreaks(element);
  const pageRanges = [0, ...breaks.filter((value) => value < totalHeight), totalHeight];

  let firstPage = true;
  for (let index = 0; index + 1 < pageRanges.length; index += 1) {
    const sliceTop = pageRanges[index]!;
    const sliceBottom = pageRanges[index + 1]!;
    const sliceHeight = sliceBottom - sliceTop;
    if (sliceHeight <= 0) continue;

    const canvas = await html2canvas(element, {
      backgroundColor: "#ffffff",
      height: Math.min(sliceHeight, MAX_SLICE_HEIGHT_PX),
      logging: false,
      scale: 2,
      scrollY: -sliceTop,
      useCORS: true,
      windowHeight: Math.min(sliceHeight, MAX_SLICE_HEIGHT_PX),
      windowWidth: element.scrollWidth,
      y: sliceTop,
    });
    if (canvas.width < 1 || canvas.height < 1) continue;

    if (firstPage) {
      firstPage = false;
    } else {
      pdf.addPage();
    }
    const imgHeight = (sliceHeight * A4_WIDTH_MM) / EXPORT_WIDTH_PX;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4_WIDTH_MM, imgHeight, undefined, "FAST");
  }

  if (firstPage) {
    const canvas = await html2canvas(element, {
      backgroundColor: "#ffffff",
      logging: false,
      scale: 2,
      useCORS: true,
      windowHeight: element.scrollHeight,
      windowWidth: element.scrollWidth,
    });
    if (canvas.width < 1 || canvas.height < 1) {
      throw new Error("PDF render produced an empty canvas.");
    }
    const image = canvas.toDataURL("image/jpeg", 0.92);
    const imgHeight = (canvas.height * A4_WIDTH_MM) / Math.max(canvas.width, 1);
    pdf.addImage(image, "JPEG", 0, 0, A4_WIDTH_MM, imgHeight, undefined, "FAST");
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}

export async function renderNotePdf({
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
}) {
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
  const fullHtml = htmlDocument(title, bodyHtml, languageTag);

  // Render it in a hidden iframe so the CSS matches HTML export exactly.
  const iframeBody = await renderHtmlInIframe(fullHtml);
  try {
    return await elementToPdfBytes(iframeBody, title);
  } finally {
    iframeBody.closest("iframe")?.remove();
  }
}
