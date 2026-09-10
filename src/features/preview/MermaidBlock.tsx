import { useEffect, useState } from "react";
import { getCachedMermaidSvg, renderMermaidDiagram } from "./mermaid-runtime";

/** Tracks the `data-theme` attribute on <html> so MermaidBlock re-renders
 * when the user toggles between light and dark — the mermaid runtime
 * picks a different theme + palette and the cached SVG must be swapped. */
function useThemeToken() {
  const [theme, setTheme] = useState(
    typeof document !== "undefined" ? document.documentElement.dataset.theme ?? "light" : "light",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme ?? "light";
      setTheme((prev) => (prev !== next ? next : prev));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export default function MermaidBlock({ code }: { code: string }) {
  const theme = useThemeToken();
  const cached = getCachedMermaidSvg(code);
  const [svg, setSvg] = useState(cached || "");
  const [error, setError] = useState("");

  useEffect(() => {
    const hit = getCachedMermaidSvg(code);
    if (hit) {
      setSvg(hit);
      setError("");
      return;
    }
    let cancelled = false;
    void renderMermaidDiagram(code)
      .then((next) => {
        if (!cancelled) {
          setSvg(next);
          setError("");
        }
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return <pre className="border-danger/30 bg-danger/5 text-danger">{error}</pre>;
  }
  return (
    <div
      className="my-4 overflow-auto rounded-lg border border-border bg-elevated p-4"
      data-mermaid-pending={svg ? undefined : ""}
      dangerouslySetInnerHTML={{ __html: svg || "Rendering diagram..." }}
    />
  );
}
