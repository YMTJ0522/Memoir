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

/** rgb()/rgba() → #rrggbb / #rrggbbaa (alpha dropped when 1). */
export function rgbToHex(rgb: string): string {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(
    rgb.trim(),
  );
  if (!match) return rgb;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, "0");
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (alpha >= 1) {
    return `#${toHex(Number(match[1]))}${toHex(Number(match[2]))}${toHex(Number(match[3]))}`;
  }
  return `#${toHex(Number(match[1]))}${toHex(Number(match[2]))}${toHex(Number(match[3]))}${toHex(
    alpha * 255,
  )}`;
}

/** One-shot: resolve a custom property to a concrete hex colour string. */
export function resolveThemeColor(property: string, fallbackHex: string): string {
  return rgbToHex(readCssColor(property, fallbackHex));
}

/**
 * Blend two CSS colours (resolve first) with a weight toward the first one,
 * returning a concrete hex. Mirrors `color-mix(in srgb, a 65%, b)`.
 */
export function mixColors(a: string, b: string, weightA = 0.65): string {
  const toRgb = (value: string) => {
    const resolved = resolveCssColor(value);
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(
      resolved,
    );
    return match
      ? {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] === undefined ? 1 : Number(match[4]),
        }
      : null;
  };
  const ca = toRgb(a);
  const cb = toRgb(b);
  if (!ca || !cb) return rgbToHex(resolveCssColor(a));
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