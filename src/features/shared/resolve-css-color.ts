/**
 * Resolve a CSS color value (hex, var(), color-mix(), rgb()…) to a concrete
 * rgb/rgba string that SVG attributes and third-party renderers (mermaid,
 * markmap) can consume.
 *
 * mermaid's colour parser and d3's colour interpolation both reject
 * `color-mix(...)` strings. When the app is in dark mode with a non-ink accent,
 * tokens.css defines `--memoir-accent-soft` as a `color-mix(...)` expression;
 * passing that raw string into mermaid's themeVariables crashes rendering
 * ("Unsupported color format"), and using it as a markmap SVG stroke attribute
 * breaks colour transitions.
 *
 * The browser resolves such expressions in `getComputedStyle`, so we probe a
 * detached element whose style sets the value, then read back the resolved
 * colour. The result is a stable, concrete colour string.
 */

let probe: HTMLDivElement | null = null;

function probeElement(): HTMLDivElement {
  if (!probe) {
    probe = document.createElement("div");
    // keep it out of layout/paint
    probe.style.display = "none";
    document.documentElement.appendChild(probe);
  }
  return probe;
}

/** Resolve a raw CSS colour value (may reference custom properties) to rgb(). */
export function resolveCssColor(raw: string): string {
  const value = raw.trim();
  if (!value || typeof document === "undefined") return value;
  const el = probeElement();
  // Clear previous assignments so a failed probe falls back cleanly.
  el.style.removeProperty("color");
  el.style.color = value;
  const resolved = getComputedStyle(el).color;
  el.style.removeProperty("color");
  return resolved;
}

/** Resolve a CSS custom property name (e.g. --memoir-accent-soft) to rgb(). */
export function readCssColor(property: string, fallback = "transparent"): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  if (!raw) return fallback;
  const resolved = resolveCssColor(raw);
  return resolved && resolved !== "rgba(0, 0, 0, 0)" ? resolved : fallback;
}

type Rgba = { r: number; g: number; b: number; a: number };

/**
 * Parse any browser-computed colour string into RGBA channels. Handles:
 * - `#rgb` / `#rrggbb` / `#rrggbbaa`
 * - `rgb()` / `rgba()` (comma or space separated)
 * - `color(srgb r g b [/ a])` — the CSS Color 4 computed form that modern
 *   WebView2 engines return for `color-mix(...)` values. mermaid cannot parse
 *   this form, so it must be converted to hex before use.
 */
export function parseCssColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;

  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const expand = (c: string) => parseInt(c + c, 16);
      return {
        r: expand(h[0]),
        g: expand(h[1]),
        b: expand(h[2]),
        a: h.length === 4 ? expand(h[3]) / 255 : 1,
      };
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const fn =
    /^rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (fn) {
    const chan = (n: string) =>
      n.endsWith("%") ? Math.round((Number(n.slice(0, -1)) / 100) * 255) : Math.round(Number(n));
    const clamp = (n: number) => Math.max(0, Math.min(255, n));
    const a = fn[4] === undefined ? 1 : Number(fn[4].replace("%", "")) / (fn[4].endsWith("%") ? 100 : 1);
    return { r: clamp(chan(fn[1])), g: clamp(chan(fn[2])), b: clamp(chan(fn[3])), a };
  }

  const srgb =
    /^color\(\s*srgb\s+([\d.%]+)\s+([\d.%]+)\s+([\d.%]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/.exec(v);
  if (srgb) {
    const chan = (n: string) =>
      n.endsWith("%")
        ? Math.round((Number(n.slice(0, -1)) / 100) * 255)
        : Math.round(Number(n) * 255);
    const clamp = (n: number) => Math.max(0, Math.min(255, n));
    let a = 1;
    if (srgb[4] !== undefined) {
      a = srgb[4].endsWith("%") ? Number(srgb[4].slice(0, -1)) / 100 : Number(srgb[4]);
    }
    return { r: clamp(chan(srgb[1])), g: clamp(chan(srgb[2])), b: clamp(chan(srgb[3])), a };
  }

  return null;
}

/** rgb()/rgba()/color(srgb…) → #rrggbb / #rrggbbaa (alpha dropped when 1). */
export function rgbToHex(rgb: string): string {
  const c = parseCssColor(rgb);
  if (!c) return rgb;
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const base = `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
  return c.a >= 1 ? base : `${base}${toHex(c.a * 255)}`;
}

/** One-shot: resolve a custom property to a concrete hex colour string.
 *  Falls back to the given hex when the token is missing or unparseable, so
 *  mermaid/markmap never receive an unsupported colour format. */
export function resolveThemeColor(property: string, fallbackHex: string): string {
  const resolved = rgbToHex(readCssColor(property, fallbackHex));
  // If parsing failed the original string passes through unchanged — that
  // would still crash mermaid, so substitute the safe fallback instead.
  return resolved.startsWith("#") ? resolved : fallbackHex;
}

/**
 * Blend two CSS colours (resolve first) with a weight toward the first one,
 * returning a concrete hex. Mirrors `color-mix(in srgb, a 65%, b)`.
 */
export function mixColors(a: string, b: string, weightA = 0.65): string {
  const ca = parseCssColor(resolveCssColor(a));
  const cb = parseCssColor(resolveCssColor(b));
  if (!ca || !cb) {
    const fallback = parseCssColor(resolveCssColor(a));
    return fallback ? rgbToHex(resolveCssColor(a)) : "#808080";
  }
  const w = Math.max(0, Math.min(1, weightA));
  const r = Math.round(ca.r * w + cb.r * (1 - w));
  const g = Math.round(ca.g * w + cb.g * (1 - w));
  const bl = Math.round(ca.b * w + cb.b * (1 - w));
  const alpha = ca.a * w + cb.a * (1 - w);
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  if (alpha >= 1) return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}${toHex(alpha * 255)}`;
}