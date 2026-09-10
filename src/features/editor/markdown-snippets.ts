/**
 * Toolbar markdown snippets shared by toolbar-commands.ts. Kept separate
 * from markdown-commands.ts (state transforms) so both files stay small.
 */

/**
 * 3-column table template; the header row is i18n text supplied by the
 * caller (toolbarTable). This default matches the English catalog.
 */
export const TABLE_SNIPPET = "| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |";
export const TABLE_CURSOR_OFFSET = 2;

/** Empty math block; cursor lands between the $$ fences. */
export const MATH_BLOCK_SNIPPET = "$$\n\n$$\n";
export const MATH_BLOCK_CURSOR_OFFSET = 3;

/** Mermaid diagram fallback content for the wrapped block insert. */
export const MERMAID_FALLBACK = "flowchart LR\n  A --> B";

/** Horizontal rule block; cursor lands after the blank line. */
export const HORIZONTAL_RULE_SNIPPET = "---\n\n";
export const HORIZONTAL_RULE_CURSOR_OFFSET = 5;

/** Details block (space syntax); cursor lands between the brackets. */
export const DETAILS_OPEN = "::: details []";
export const DETAILS_CLOSE = ":::";

/** Advanced code fence info string: language + title + line numbers + highlight. */
export const ADVANCED_CODE_INFO = 'text title="" line-numbers {1}';
