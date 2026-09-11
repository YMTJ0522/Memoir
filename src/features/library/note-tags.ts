/**
 * Set the `tags` field of a note's frontmatter, preserving the rest of the
 * document byte-for-byte. When the note has no frontmatter block, one is
 * inserted at the top (with only the tags field) so tags survive round-trips.
 *
 * The frontmatter is edited line-by-line instead of re-stringifying parsed
 * data: gray-matter turns values like `date: 2020-01-01` into Date objects,
 * and re-serializing would rewrite unrelated fields.
 */

function yamlList(tags: string[]): string {
  // Compact YAML flow list, e.g. `tags: ["work", "ideas"]`. JSON string
  // escaping is a subset of YAML double-quoted scalars, so this is safe.
  return `[${tags.map((tag) => JSON.stringify(tag)).join(", ")}]`;
}

export function updateNoteTags(content: string, tags: string[]): string {
  const cleaned = normalizeTags(tags);
  if (!/^---\r?\n/.test(content)) {
    const header = cleaned.length ? `---\ntags: ${yamlList(cleaned)}\n---\n\n` : "";
    return `${header}${content}`;
  }

  const newline = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return content; // Malformed frontmatter: leave untouched.

  const tagsLine = `tags: ${yamlList(cleaned)}`;
  const result: string[] = [];
  let replaced = false;
  let index = 1;
  for (; index < end; index += 1) {
    const line = lines[index];
    if (/^tags:\s*/.test(line)) {
      if (!replaced) {
        result.push(cleaned.length ? tagsLine : "");
        replaced = true;
      }
      // Skip any indented continuation lines (block-list items).
      while (index + 1 < end && /^\s+\S/.test(lines[index + 1])) index += 1;
      continue;
    }
    result.push(line);
  }
  if (!replaced && cleaned.length) {
    result.push(tagsLine);
  }
  const body = lines.slice(end + 1);
  while (body.length && body[0] === "") body.shift();
  // Drop an empty frontmatter block entirely (all fields removed/cleared).
  const frontmatter = result.filter((line) => line.trim() !== "");
  if (!frontmatter.length) {
    return body.length ? `${body.join(newline)}${newline}` : "";
  }
  return ["---", ...frontmatter, "---", "", ...body].join(newline);
}

/** Normalizes user input into a clean, de-duplicated tag list. */
export function normalizeTags(input: string[]): string[] {
  return [...new Set(input.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
}
