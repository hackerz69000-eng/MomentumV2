export type ScopedSource = { text: string; note?: string };

/**
 * Applies explicit assignment source restrictions before text is sent to the AI.
 * This intentionally fails closed: an unknown limit must never result in sending
 * the entire source with only a warning in the prompt.
 */
export function restrictAssignmentSource(text: string, scope: string): ScopedSource {
  const s = scope.trim();
  if (!s) return { text };

  const firstPages = s.match(/\b(?:first|initial)\s+(\d+)\s+pages?\b/i);
  const pageRange = s.match(/\b(?:(?:pdf|document|extracted)\s+)?pages?\s*(\d+)\s*(?:-|–|—|to|through)\s*(\d+)\b/i);
  const pageLabelsExist = /^#{0,3}\s*Page\s+\d+\s*$/im.test(text);

  if (firstPages) {
    const end = Number(firstPages[1]);
    if (!Number.isSafeInteger(end) || end < 1 || end > 10000) {
      return { text: "", note: `The requested limit (${s}) is invalid. Ask the student to clarify the permitted range.` };
    }
    if (!pageLabelsExist) {
      return { text: "", note: `The first ${end} pages cannot be isolated because the extracted text has no reliable page labels. Ask the student to upload the permitted excerpt; do not use the full source.` };
    }
    const selected = selectPageRange(text, 1, end);
    return selected
      ? { text: selected, note: `Restricted to extracted document pages 1–${end}. Verify that these page labels match the assignment's intended pagination.` }
      : { text: "", note: `The requested first ${end} pages could not be isolated from the extracted page labels. Ask the student to upload the permitted excerpt.` };
  }

  if (pageRange) {
    const explicitlyDocumentPages = /\bpdf\s+pages?\b|\bdocument\s+pages?\b|\bextracted\s+pages?\b/i.test(s);
    if (!explicitlyDocumentPages) {
      return { text: "", note: `The requested ${s} may refer to printed page numbers rather than PDF/document page indices. Do not use this source until the student clarifies the pagination or uploads the permitted excerpt.` };
    }
    if (!pageLabelsExist) {
      return { text: "", note: `The requested ${s} cannot be isolated because the extracted text has no reliable page labels. Ask the student to upload the permitted excerpt; do not use the full source.` };
    }
    const start = Number(pageRange[1]);
    const end = Number(pageRange[2]);
    const selected = selectPageRange(text, Math.min(start, end), Math.max(start, end));
    return selected
      ? { text: selected }
      : { text: "", note: `The requested ${s} could not be isolated from extracted page labels. Ask the student to upload the permitted excerpt.` };
  }

  const chapterRange = s.match(/\bchapters?\s*(\d+)\s*(?:-|–|—|to|through\s+)?\s*(\d+)?\b/i);
  if (chapterRange) {
    const remainder = s.slice((chapterRange.index ?? 0) + chapterRange[0].length);
    if (/^\s*(?:and|,|or)\s*\d+\b/i.test(remainder)) {
      return { text: "", note: `The chapter list in (${s}) is not a single chapter or continuous range. Ask the student to upload the permitted chapters together as an excerpt so no unapproved content is included.` };
    }
    const start = Number(chapterRange[1]);
    const end = Number(chapterRange[2] || chapterRange[1]);
    const chunks = text.split(/(?=^#{0,3}\s*Chapter\s+\d+\b)/im);
    if (chunks.length <= 1) {
      return { text: "", note: `The extracted text does not clearly mark chapter boundaries, so ${s} cannot be safely isolated. Ask the student to upload the permitted chapter/excerpt.` };
    }
    const chosen = chunks.filter((chunk) => {
      const match = chunk.match(/^#{0,3}\s*Chapter\s+(\d+)\b/im);
      return match && Number(match[1]) >= Math.min(start, end) && Number(match[1]) <= Math.max(start, end);
    });
    return chosen.length
      ? { text: chosen.join("\n\n") }
      : { text: "", note: `The requested ${s} could not be isolated. Ask the student to upload the permitted excerpt.` };
  }

  const named = s.match(/(?:section|part|heading)\s*[“"']?([^”"']{3,80})[”"']?/i);
  if (named) {
    const target = named[1].trim().replace(/[.:;]+$/, "").toLowerCase();
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => line.replace(/^#{0,3}\s*/, "").trim().toLowerCase() === target);
    if (start < 0) {
      return { text: "", note: `The requested portion (${s}) could not be identified by its heading. Ask the student to upload that specific excerpt; do not use the rest of the source.` };
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^#{1,3}\s+/.test(lines[i] ?? "")) { end = i; break; }
    }
    return { text: lines.slice(start, end).join("\n") };
  }

  return {
    text: "",
    note: `The permitted-use limit (${s}) cannot be reliably isolated from this extraction. Do not use this source's full text; ask the student to upload the allowed excerpt or clarify the restriction.`,
  };
}

function selectPageRange(text: string, start: number, end: number): string {
  const chunks = text.split(/(?=^#{0,3}\s*Page\s+\d+\s*$)/im);
  const chosen = chunks.filter((chunk) => {
    const match = chunk.match(/^#{0,3}\s*Page\s+(\d+)\s*$/im);
    return match && Number(match[1]) >= start && Number(match[1]) <= end;
  });
  return chosen.join("\n\n").trim();
}
