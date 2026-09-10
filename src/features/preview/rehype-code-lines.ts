type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
  data?: Record<string, unknown>;
};

type HastText = HastNode & { type: "text"; value: string };
type HastElement = HastNode & { type: "element"; tagName: string; children: HastNode[] };

const isText = (node: HastNode): node is HastText => node.type === "text";
const isElement = (node: HastNode): node is HastElement =>
  node.type === "element" && typeof node.tagName === "string";

/**
 * Splits the `code` content of enhanced code blocks (`pre.memoir-code-block`)
 * into per-line `span.line` elements so CSS can render line numbers
 * (`data-line-number`) and highlight rows (`data-highlight-lines`), mirroring
 * inkstone's `decorateCodeBlock`. Runs after rehype-highlight so token
 * elements are preserved across line boundaries.
 */
export function rehypeCodeLines() {
  return (tree: HastNode) => {
    for (const pre of tree.children ?? []) {
      if (!isElement(pre) || !pre.tagName.startsWith?.("pre")) continue;
      const isEnhanced = Array.isArray(pre.properties?.className)
        ? (pre.properties.className as unknown[]).includes("memoir-code-block")
        : pre.properties?.className === "memoir-code-block";
      if (!isEnhanced) continue;
      const code = (pre.children ?? []).find((child) => isElement(child) && child.tagName === "code");
      if (code && isElement(code)) decorateLines(pre, code);
    }
  };
}

function decorateLines(pre: HastElement, code: HastElement) {
  const start = Math.max(1, Number(pre.properties?.dataCodeStart) || 1);
  const highlighted = new Set(
    String(pre.properties?.dataHighlightLines ?? "")
      .split(",")
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0),
  );
  const numbered = pre.properties?.dataLineNumbers === "true";
  if (numbered) {
    pre.properties = {
      ...pre.properties,
      className: [...asArray(pre.properties?.className), "has-line-numbers"],
    };
  }
  const lines = splitNodesAtNewlines(code.children ?? []);
  if (lines.length > 1 && isText(lines[lines.length - 1]?.[0]) && lines[lines.length - 1]![0]!.value === "") {
    lines.pop();
  }
  const output: HastNode[] = [];
  lines.forEach((line, index) => {
    const lineClass = highlighted.has(index + 1) ? ["line", "highlighted"] : ["line"];
    const span: HastElement = {
      type: "element",
      tagName: "span",
      properties: {
        className: lineClass,
        dataLineNumber: String(start + index),
      },
      children: line.length ? line : [{ type: "text", value: " " }],
    };
    output.push(span);
    if (index < lines.length - 1) output.push({ type: "text", value: "\n" });
  });
  code.children = output;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function splitNodesAtNewlines(nodes: HastNode[]): HastNode[][] {
  const lines: HastNode[][] = [[]];
  for (const node of nodes) {
    const parts = splitNodeAtNewlines(node);
    lines[lines.length - 1]!.push(...parts[0]!);
    for (let index = 1; index < parts.length; index++) lines.push(parts[index]!);
  }
  return lines;
}

function splitNodeAtNewlines(node: HastNode): HastNode[][] {
  if (isText(node)) return node.value.split("\n").map((text) => [{ type: "text", value: text } as HastText]);
  if (!isElement(node)) return [[node]];
  return splitNodesAtNewlines(node.children ?? []).map((children) => {
    const clone: HastElement = {
      type: "element",
      tagName: node.tagName,
      properties: { ...node.properties },
      children,
    };
    return [clone];
  });
}
