export function mermaidSourceKey(code: string) {
  return code;
}

const svgCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_CACHE = 40;
let mermaidInitialized = false;
let mermaidTheme: string | null = null;
let idSeq = 0;

/** Detect the active Memoir theme so mermaid diagrams match the surrounding
 * canvas. Mermaid only initialises once, so when the theme changes between
 * renders we must re-initialise (and the cache key includes the theme to
 * avoid serving a stale light SVG in dark mode, or vice versa). */
function currentMermaidTheme(): "dark" | "neutral" {
  if (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark") {
    return "dark";
  }
  return "neutral";
}

function cacheKey(code: string) {
  return `${currentMermaidTheme()}::${code}`;
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
    if (!mermaidInitialized || mermaidTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        theme,
        securityLevel: "strict",
        themeVariables:
          theme === "dark"
            ? {
                // Match Memoir's dark palette so diagrams blend with the
                // surrounding canvas instead of using mermaid's defaults
                // (which have white node fills with dark text — fine on
                // white, unreadable on a dark background).
                background: "#24241f",
                primaryColor: "#2d2d28",
                primaryTextColor: "#f0eee8",
                primaryBorderColor: "#4a4942",
                lineColor: "#a5a198",
                secondaryColor: "#3a3a34",
                tertiaryColor: "#1d1d1a",
                textColor: "#f0eee8",
                fontSize: "14px",
              }
            : undefined,
      });
      mermaidInitialized = true;
      mermaidTheme = theme;
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
