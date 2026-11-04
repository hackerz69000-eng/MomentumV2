/** Convert Markdown notes into speech-sized chunks without cutting through words. */
export function splitSpeechChunks(markdown: string, maxChars = 3500): string[] {
  const limit = Number.isFinite(maxChars) ? Math.max(100, Math.floor(maxChars)) : 3500;
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const paragraphs = plain.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const appendParagraph = (paragraph: string) => {
    const sentences = paragraph.match(/[^.!?]+[.!?]+(?:[”’"])?|[^.!?]+$/g) ?? [paragraph];
    for (const sentence of sentences) {
      const part = sentence.trim();
      if (!part) continue;
      if (part.length > limit) {
        const words = part.split(/\s+/);
        for (const word of words) {
          if (word.length > limit) {
            if (current) { chunks.push(current); current = ""; }
            for (let i = 0; i < word.length; i += limit) chunks.push(word.slice(i, i + limit));
          } else if (current && current.length + word.length + 1 > limit) {
            chunks.push(current);
            current = word;
          } else current += `${current ? " " : ""}${word}`;
        }
      } else if (current && current.length + part.length + 1 > limit) {
        chunks.push(current);
        current = part;
      } else current += `${current ? " " : ""}${part}`;
    }
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > limit) appendParagraph(paragraph);
    else if (current && current.length + paragraph.length + 2 > limit) {
      chunks.push(current);
      current = paragraph;
    } else current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current) chunks.push(current);
  return chunks;
}
