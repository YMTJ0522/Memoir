import { resolveThemeColor } from "../shared/resolve-css-color";

export function mermaidSourceKey(code: string) {
  return code;
}

const svgCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_CACHE = 40;
let mermaidInitialized = false;
let mermaidTheme: string | null = null;
let idSeq = 0;

/** Resolve whether the app is currently in dark mode (mermaid theme name). */
function currentMermaidTheme(): "dark" | "default" {
  if (typeof document === "undefined") return "default";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

/**
 * Read a token and resolve it to a concrete hex string. In dark mode with a
 * non-ink accent, `--memoir-accent-soft` is a `color-mix(...)` expression that
 * mermaid's colour parser rejects, so we resolve it via the DOM before passing
 * it to mermaid's themeVariables.
 */
function readVarHex(name: string, fallback: string): string {
  return resolveThemeColor(name, fallback);
}

/** Build a complete set of mermaid themeVariables that matches the current
 *  Memoir theme (light or dark) and follows the user's accent colour.
 *
 *  Both light and dark branches produce the SAME structural parameters
 *  (fontSize, fontFamily, etc.) so the generated SVG has identical metrics
 *  across theme switches — only colours change, preventing the layout
 *  jitter that occurred when light used mermaid's `neutral` defaults and
 *  dark used a fully-overridden `dark` theme. */
function memoirThemeVariables(): Record<string, string> {
  const dark = currentMermaidTheme() === "dark";
  const accent = readVarHex("--memoir-accent", dark ? "#efede7" : "#343532");
  const accentSoft = readVarHex("--memoir-accent-soft", dark ? "#393832" : "#e7e5df");
  const text = readVarHex("--memoir-text", dark ? "#f0eee8" : "#292a27");
  const muted = readVarHex("--memoir-muted", dark ? "#a5a198" : "#8c8982");
  const elevated = readVarHex("--memoir-elevated", dark ? "#24241f" : "#fffefb");
  const panel = readVarHex("--memoir-panel", dark ? "#1d1d1a" : "#f5f3ee");
  const border = readVarHex("--memoir-border", dark ? "#37362f" : "#e7e3db");

  return {
    fontSize: "14px",
    background: elevated,
    primaryColor: accentSoft,
    primaryTextColor: text,
    primaryBorderColor: accent,
    lineColor: muted,
    secondaryColor: panel,
    tertiaryColor: border,
    textColor: text,
    // Mermaid also reads these for sequencediagram / class diagram / etc.
    nodeBkg: accentSoft,
    nodeBorder: accent,
    clusterBkg: panel,
    clusterBorder: border,
    titleColor: text,
    edgeLabelBackground: elevated,
    labelBoxBkgColor: accentSoft,
    // accent fill for active nodes
    activeTaskBorderColor: accent,
    doneTaskBorderColor: accent,
    critBorderColor: "#c94c41",
  };
}

function themeSignature(): string {
  return `${currentMermaidTheme()}::${readVarHex("--memoir-accent", "")}::${readVarHex(
    "--memoir-accent-soft",
    "",
  )}`;
}

function cacheKey(code: string) {
  return `${themeSignature()}::${code}`;
}

export function getCachedMermaidSvg(code: string) {
  return svgCache.get(cacheKey(code));
}

function rememberSvg(code: string, svg: string) {
  const key = cacheKey(code);
  if (svgCache.size >= MAX_CACHE && !svgCache.has(key)) {
    const oldest = svgCache.keys().next().value;
    if (oldest) svgCache.delete(oldest);
  }
  svgCache.set(key, svg);
}

export async function renderMermaidDiagram(code: string) {
  const key = cacheKey(code);
  const cached = svgCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const { default: mermaid } = await import("mermaid");
    const theme = currentMermaidTheme();
    const sig = themeSignature();
    if (!mermaidInitialized || mermaidTheme !== sig) {
      mermaid.initialize({
        startOnLoad: false,
        theme,
        securityLevel: "strict",
        // Disable HTML labels (foreignObject) so the rendered SVG can be
        // rasterized to PNG via canvas — foreignObject taints the canvas and
        // makes toDataURL() throw a SecurityError. Pure-SVG text looks nearly
        // identical and supports <br/> line breaks.
        htmlLabels: false,
        themeVariables: memoirThemeVariables(),
      });
      mermaidInitialized = true;
      mermaidTheme = sig;
    }
    idSeq += 1;
    const result = await mermaid.render(`memoir-mmd-${idSeq}`, code);
    rememberSvg(code, result.svg);
    return result.svg;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

export function resetMermaidRuntime() {
  svgCache.clear();
  inflight.clear();
  mermaidInitialized = false;
  mermaidTheme = null;
  idSeq = 0;
}
