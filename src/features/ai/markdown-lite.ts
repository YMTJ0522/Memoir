/**
 * Lightweight Markdown renderer for AI chat bubbles.
 *
 * Supports a practical subset used in chat replies: headings, bullet /
 * ordered / task lists, fenced code blocks, inline code, bold / italic /
 * strikethrough, blockquotes, links, and horizontal rules. Everything is
 * escaped first, so the generated HTML is safe to inject.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  // `code`
  let html = escapeHtml(text);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // images: ![alt](src) — render as plain link text; remote images in chat
  // bubbles are noisy and the src is untrusted.
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string, src: string) => {
    return safeLink(src, alt || src);
  });
  // links: [text](src) — http(s) only
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, label: string, href: string) => safeLink(href, label),
  );
  // bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|\s)__([^_\n]+)__/g, "$1<strong>$2</strong>");
  // italic
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  html = html.replace(/(^|\s)_([^_\n]+)_/g, "$1<em>$2</em>");
  // strikethrough
  html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  return html;
}

function safeLink(href: string, label: string): string {
  const decoded = href.replace(/&amp;/g, "&");
  if (!/^https?:\/\//i.test(decoded)) {
    return label;
  }
  return `<a href="${escapeHtml(decoded)}" rel="noopener noreferrer" target="_blank">${escapeHtml(
    label,
  )}</a>`;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; language: string; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[]; tasks: Array<boolean | null> }
  | { kind: "rule" };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    // fenced code block
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      const language = fence[1] || "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1; // skip closing fence
      blocks.push({ kind: "code", language, text: codeLines.join("\n") });
      continue;
    }

    // heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    // blockquote (consume consecutive > lines)
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quoteLines.join("\n") });
      continue;
    }

    // list (bullet / ordered / task)
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      const tasks: Array<boolean | null> = [];
      while (index < lines.length) {
        const current = lines[index];
        const currentBullet = current.match(/^\s*[-*+]\s+(.*)$/);
        const currentOrdered = current.match(/^\s*\d+[.)]\s+(.*)$/);
        const match = isOrdered ? currentOrdered : currentBullet;
        if (!match) break;
        const itemText = match[1];
        const task = itemText.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          items.push(task[2]);
          tasks.push(task[1].toLowerCase() === "x");
        } else {
          items.push(itemText);
          tasks.push(null);
        }
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items, tasks });
      continue;
    }

    // paragraph (consume until blank line or block start)
    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current.trim() === "") break;
      if (
        /^\s*```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        /^\s*>/.test(current) ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current) ||
        /^\s*([-*_])(\s*\1){2,}\s*$/.test(current)
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    if (paragraphLines.length) {
      blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
    }
  }

  return blocks;
}

export function renderMarkdownLite(markdown: string): string {
  if (!markdown) return "";
  const blocks = parseBlocks(markdown);
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = Math.min(Math.max(block.level, 1), 6);
        parts.push(`<h${level}>${renderInline(block.text)}</h${level}>`);
        break;
      }
      case "code":
        parts.push(
          `<pre><code>${escapeHtml(block.text)}</code></pre>`,
        );
        break;
      case "quote":
        parts.push(`<blockquote>${renderInline(block.text).replace(/\n/g, "<br />")}</blockquote>`);
        break;
      case "rule":
        parts.push("<hr />");
        break;
      case "list": {
        const hasTasks = block.tasks.some((task) => task !== null);
        if (hasTasks) {
          const items = block.items
            .map(
              (item, itemIndex) =>
                `<li><span class="ai-task${
                  block.tasks[itemIndex] ? " is-done" : ""
                }">${renderInline(item)}</span></li>`,
            )
            .join("");
          parts.push(`<ul class="ai-task-list">${items}</ul>`);
        } else {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
          parts.push(`<${tag}>${items}</${tag}>`);
        }
        break;
      }
      case "paragraph":
        parts.push(`<p>${renderInline(block.text).replace(/\n/g, "<br />")}</p>`);
        break;
    }
  }

  return parts.join("");
}
