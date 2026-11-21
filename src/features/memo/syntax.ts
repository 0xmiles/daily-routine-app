// The two line-level marks a memo understands besides bullets and **bold**,
// shared by the editor (which draws them) and the list (which strips them).
// Both only count at the very start of a line, with no indentation.

/** `#`, `##`, `###` and at least one space or tab. `####` and `#제목` are plain text. */
const HEADING_RE = /^(#{1,3})[ \t]+/;
/** Three or more `-` and nothing else (trailing spaces allowed). `- ` stays a bullet. */
const RULE_RE = /^-{3,}[ \t]*$/;

export type HeadingLevel = 0 | 1 | 2 | 3;

/** Heading level of a line (0 = not a heading). A heading with no text yet still counts. */
export function headingLevel(lineText: string): HeadingLevel {
  const m = HEADING_RE.exec(lineText);
  return m ? (m[1].length as HeadingLevel) : 0;
}

/** Length of a heading line's `## ` prefix (0 if it isn't one). */
export function headingPrefixLength(lineText: string): number {
  return HEADING_RE.exec(lineText)?.[0].length ?? 0;
}

/** True for a `---` divider line. */
export function isRuleLine(lineText: string): boolean {
  return RULE_RE.test(lineText);
}
