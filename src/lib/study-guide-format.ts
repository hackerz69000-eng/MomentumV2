/**
 * Makes AI-generated Markdown readable even when a model returns escaped pipes or
 * compresses an entire Markdown table onto one line. ReactMarkdown intentionally
 * runs without a GFM plugin in this project, so tables are converted into
 * accessible, labeled lists instead of being shown as raw pipe-delimited text.
 */
export function formatStudyGuideMarkdown(markdown: string): string {
  const expandedLines = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((originalLine) => {
      let line = originalLine;
      const escapedPipeCount = (line.match(/\\\|/g) ?? []).length;
      const looksLikeTable = escapedPipeCount >= 3 || ((line.trim().startsWith("|") || line.trim().startsWith("\\|")) && line.includes("---"));

      if (looksLikeTable) line = line.replace(/\\\|/g, "|");

      // A collapsed table commonly looks like `| a | b | |---|---| | x | y |`.
      // Expanding the adjacent closing/opening pipes restores one row per line.
      if (line.includes("---") && (line.match(/\|/g) ?? []).length >= 6) {
        line = line.replace(/\|\s+\|/g, "|\n|");
      }
      return line.split("\n");
    });

  const output: string[] = [];
  let index = 0;

  while (index < expandedLines.length) {
    const line = expandedLines[index] ?? "";
    const next = expandedLines[index + 1] ?? "";
    const isTableHeader = isPipeRow(line) && isTableSeparator(next);

    if (!isTableHeader) {
      output.push(line);
      index += 1;
      continue;
    }

    const headers = parseCells(line);
    const rows: string[][] = [];
    index += 2;
    while (index < expandedLines.length && isPipeRow(expandedLines[index] ?? "")) {
      rows.push(parseCells(expandedLines[index] ?? ""));
      index += 1;
    }

    if (output.length && output[output.length - 1]?.trim()) output.push("");
    for (const row of rows) {
      const primary = row[0]?.trim();
      if (!primary) continue;
      output.push(`- **${primary}**`);
      for (let cellIndex = 1; cellIndex < headers.length; cellIndex += 1) {
        const value = row[cellIndex]?.trim();
        if (!value) continue;
        output.push(`  - **${headers[cellIndex]?.trim() || `Detail ${cellIndex}`}:** ${value}`);
      }
    }
    output.push("");
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isPipeRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.split("|").length >= 3;
}

function isTableSeparator(line: string): boolean {
  if (!isPipeRow(line)) return false;
  const cells = parseCells(line);
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function parseCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
