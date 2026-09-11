import { getGateways } from "../../gateways";
import { useAppStore } from "../../store/app-store";

/**
 * Flowchart export helpers.
 *
 * Mermaid renders its diagrams into an <svg> that uses CSS variables and
 * cascade from the app stylesheet. Serializing the DOM as-is loses those
 * colors, so before export we walk a deep clone and inline every computed
 * style that matters — mirroring export-mindmap.ts.
 */

const INLINE_STYLE_PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "fill-opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "opacity",
] as const;

function inlineStyles(node: SVGElement) {
  const computed = getComputedStyle(node);
  for (const prop of INLINE_STYLE_PROPS) {
    const value = computed.getPropertyValue(prop);
    if (value && value !== "none" && value !== "normal") {
      node.style.setProperty(prop, value);
    }
  }
}

function walk(node: Element) {
  inlineStyles(node as SVGElement);
  for (const child of Array.from(node.children)) {
    walk(child);
  }
}

function computeSvgBox(svg: SVGSVGElement) {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || svg.clientWidth || 800));
  const height = Math.max(1, Math.round(rect.height || svg.clientHeight || 600));
  return { width, height };
}

/** Serialize a mermaid SVG into a self-contained SVG document string. */
export function serializeFlowchartSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(clone);
  for (const child of Array.from(clone.children)) {
    walk(child);
  }
  const { width, height } = computeSvgBox(svg);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  clone.removeAttribute("style");
  const xml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/** Rasterize the serialized SVG into PNG bytes (base64) at 2x resolution. */
export async function serializeFlowchartPng(svg: SVGSVGElement): Promise<string> {
  const svgText = serializeFlowchartSvg(svg);
  const { width, height } = computeSvgBox(svg);
  const scale = 2;
  const blobUrl = URL.createObjectURL(
    new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = await loadImage(blobUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width * scale);
    canvas.height = Math.max(1, height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析导出的 SVG 图片"));
    image.src = src;
  });
}

function flowchartFileName(extension: string) {
  const state = useAppStore.getState();
  const note = state.notes.find((item) => item.relativePath === state.activePath);
  const base = note?.title || note?.fileName || "flowchart";
  const safe = base.replace(/[\\/:*?"<>|]/g, "_").replace(/\.(md|mdx)$/i, "");
  return `${safe || "flowchart"}.${extension}`;
}

function currentT(key: "png" | "svg", suffix: "dialog" | "status" | "errors", message?: string) {
  const prefix = key === "png" ? "PNG" : "SVG";
  if (suffix === "dialog") return `导出 ${prefix}${key === "svg" ? " 矢量图" : " 图片"}`;
  if (suffix === "status") return `已导出 ${prefix}${key === "svg" ? " 矢量图" : " 图片"}`;
  return `导出 ${prefix} 失败：${message ?? ""}`;
}

/** Export the current flowchart diagram as PNG (raster) or SVG (vector). */
export async function exportFlowchart(svg: SVGSVGElement, format: "png" | "svg") {
  const previousStatus = useAppStore.getState().status;
  try {
    const chosen = await getGateways().workspace.chooseExportFile({
      defaultPath: flowchartFileName(format),
      title: currentT(format, "dialog"),
      format,
    });
    if (!chosen) return null;
    useAppStore.setState({ error: "", status: "正在导出…" });
    if (format === "svg") {
      const text = serializeFlowchartSvg(svg);
      await getGateways().workspace.writeExportText(chosen, text, "image/svg+xml;charset=utf-8");
    } else {
      const base64 = await serializeFlowchartPng(svg);
      await getGateways().workspace.writeExportFile(chosen, base64);
    }
    useAppStore.setState({ status: currentT(format, "status") });
    return chosen;
  } catch (error) {
    useAppStore.setState({
      error: currentT(format, "errors", error instanceof Error ? error.message : String(error)),
      status: previousStatus,
    });
    return null;
  }
}