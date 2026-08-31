/**
 * A small Markdown subset, parsed into a tree the renderer turns into React
 * elements.
 *
 * It stops at a tree rather than producing HTML on purpose: nothing here can
 * inject markup, because nothing here produces markup. A `.md` file posted to a
 * channel is written by whoever uploaded it, so the safe thing and the simple
 * thing had better be the same thing.
 *
 * The subset is what a README actually uses: headings, paragraphs, fenced and
 * indented code, lists, quotes, rules and tables, with bold, italic, strike,
 * code and links inline.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "code"; language: string; value: string }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "rule" }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] };

/** Parses a document into blocks. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let at = 0;

  while (at < lines.length) {
    const line = lines[at]!;

    if (line.trim() === "") {
      at += 1;
      continue;
    }

    // Fenced code. The closing fence is optional: a truncated preview should
    // still render the code it did receive rather than nothing at all.
    const fence = /^\s*(```|~~~)\s*(\S*)/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const language = fence[2] ?? "";
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !lines[at]!.trimStart().startsWith(marker)) {
        body.push(lines[at]!);
        at += 1;
      }
      at += 1;
      blocks.push({ type: "code", language, value: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1]!.length,
        children: parseInline(heading[2]!.replace(/\s+#+\s*$/, "")),
      });
      at += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ type: "rule" });
      at += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (at < lines.length && /^\s*>/.test(lines[at]!)) {
        body.push(lines[at]!.replace(/^\s*>\s?/, ""));
        at += 1;
      }
      blocks.push({ type: "quote", children: parseInline(body.join(" ")) });
      continue;
    }

    const table = parseTable(lines, at);
    if (table) {
      blocks.push(table.block);
      at = table.next;
      continue;
    }

    const bullet = /^\s*([-*+]|\d{1,9}[.)])\s+/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]!);
      const items: Inline[][] = [];
      while (at < lines.length) {
        const item = /^\s*([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[at]!);
        if (!item) break;
        if (/\d/.test(item[1]!) !== ordered) break;
        items.push(parseInline(item[2]!));
        at += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Anything else is a paragraph, running until a blank line or the start of
    // a block that is not one.
    const paragraph: string[] = [];
    while (at < lines.length && lines[at]!.trim() !== "" && !startsBlock(lines[at]!)) {
      paragraph.push(lines[at]!.trim());
      at += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    } else {
      // A line that starts a block but was not consumed above would loop
      // forever; taking it as a paragraph is wrong but finite.
      blocks.push({ type: "paragraph", children: parseInline(lines[at]!.trim()) });
      at += 1;
    }
  }

  return blocks;
}

/** Whether a line opens a block that a paragraph must not swallow. */
function startsBlock(line: string): boolean {
  return (
    /^\s*(```|~~~)/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*+]|\d{1,9}[.)])\s+/.test(line) ||
    /^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)
  );
}

/** Splits a table row into its cells, tolerating the optional outer pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Reads a pipe table starting at `at`, or nothing when there is not one. */
function parseTable(lines: string[], at: number): { block: Block; next: number } | null {
  const header = lines[at];
  const divider = lines[at + 1];
  if (!header || !divider) return null;
  if (!header.includes("|")) return null;
  if (!/^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(divider)) return null;

  const columns = splitRow(header);
  if (columns.length < 2) return null;

  let cursor = at + 2;
  const rows: Inline[][][] = [];
  while (cursor < lines.length && lines[cursor]!.includes("|") && lines[cursor]!.trim() !== "") {
    rows.push(splitRow(lines[cursor]!).map(parseInline));
    cursor += 1;
  }

  return {
    block: { type: "table", header: columns.map(parseInline), rows },
    next: cursor,
  };
}

/**
 * Parses the inline span of one block.
 *
 * Code is matched first and never looked inside, which is what makes
 * `` `**not bold**` `` render as the four characters somebody typed.
 */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";

  const flush = () => {
    if (text) {
      out.push({ type: "text", value: text });
      text = "";
    }
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);

    const code = /^(`+)([\s\S]*?)\1/.exec(rest);
    if (code) {
      flush();
      out.push({ type: "code", value: code[2]!.trim() });
      i += code[0].length;
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      flush();
      const href = link[2]!;
      // Only the two schemes that mean "a page": anything else in a link a
      // stranger wrote is not worth making clickable.
      if (/^https?:\/\//i.test(href)) {
        out.push({ type: "link", href, children: parseInline(link[1]!) });
      } else {
        out.push(...parseInline(link[1]!));
      }
      i += link[0].length;
      continue;
    }

    // A bare image renders as its alt text: fetching a remote picture named by
    // an uploaded file would leak that the file was opened, and to whom.
    const image = /^!\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)/.exec(rest);
    if (image) {
      flush();
      out.push(...parseInline(image[1]!));
      i += image[0].length;
      continue;
    }

    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      flush();
      out.push({ type: "strong", children: parseInline(strong[2]!) });
      i += strong[0].length;
      continue;
    }

    const strike = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest);
    if (strike) {
      flush();
      out.push({ type: "strike", children: parseInline(strike[1]!) });
      i += strike[0].length;
      continue;
    }

    const em = /^([*_])(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (em) {
      flush();
      out.push({ type: "em", children: parseInline(em[2]!) });
      i += em[0].length;
      continue;
    }

    const bare = /^https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)]/.exec(rest);
    if (bare) {
      flush();
      out.push({ type: "link", href: bare[0], children: [{ type: "text", value: bare[0] }] });
      i += bare[0].length;
      continue;
    }

    // A backslash escapes the character after it, which is how somebody writes
    // an asterisk they mean literally.
    if (rest.startsWith("\\") && rest.length > 1) {
      text += rest[1];
      i += 2;
      continue;
    }

    text += source[i];
    i += 1;
  }

  flush();
  return out;
}
