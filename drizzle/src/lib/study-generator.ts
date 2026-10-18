// Generator for proper study notes and exactly 20 flashcards from extracted text.
// Produces clean, readable Markdown and structured questions without gobbledygook.

export interface GeneratedFlashcard {
  q: string;
  a: string;
  t: string;
}

export interface GeneratedStudySet {
  notes: string;
  cards: GeneratedFlashcard[];
}

function cleanText(raw: string): string {
  let cleaned = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || code >= 32) {
      cleaned += raw[i];
    }
  }
  return cleaned
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parses sentences and paragraphs from the study material to build
 * high-yield concepts, definitions, and questions.
 */
function extractKeyFactsAndDefinitions(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const definitions: { term: string; definition: string; topic: string }[] = [];
  const keyPoints: { point: string; topic: string }[] = [];

  let currentTopic = "Core Concepts";

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("===") || /^[A-Z0-9\s]{3,30}:?$/.test(line)) {
      const topicName = line.replace(/^[#=]+\s*/, "").replace(/:$/, "").trim();
      if (topicName.length >= 3 && topicName.length <= 40) {
        currentTopic = topicName;
        continue;
      }
    }

    // Look for definitions formatted as "Term: Definition" or "Term - Definition" or "Term is ..."
    const colonMatch = line.match(/^([A-Za-z0-9\s-]{2,35})\s*[:—–-]\s+(.{15,})$/);
    if (colonMatch && colonMatch[1] && colonMatch[2]) {
      const term = colonMatch[1].trim();
      const def = colonMatch[2].trim();
      if (!term.toLowerCase().startsWith("http") && !term.toLowerCase().includes("page")) {
        definitions.push({ term, definition: def, topic: currentTopic });
        continue;
      }
    }

    // Look for "X is/are defined as Y"
    const isDefMatch = line.match(/^([A-Za-z0-9\s-]{2,35})\s+(?:is defined as|refers to|means|is the process of)\s+(.{15,})$/i);
    if (isDefMatch && isDefMatch[1] && isDefMatch[2]) {
      definitions.push({ term: isDefMatch[1].trim(), definition: isDefMatch[2].trim(), topic: currentTopic });
      continue;
    }

    // Meaningful informative sentences
    if (line.length >= 35 && line.length <= 250 && !line.startsWith("http") && !/^\d+$/.test(line)) {
      keyPoints.push({ point: line, topic: currentTopic });
    }
  }

  return { definitions, keyPoints };
}

/**
 * Synthesizes comprehensive notes from the study material that covers
 * all the material in the uploaded PDF / document, not just an introductory summary.
 */
export function generateNotesFromMaterial(material: string, title: string, subject: string): string {
  const cleaned = cleanText(material);
  const { definitions, keyPoints } = extractKeyFactsAndDefinitions(cleaned);

  const rawParagraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 25 && !p.startsWith("http"));

  const titleHeader = `# ${title || "Complete Study Set Notes"}\n*Subject: ${subject || "Comprehensive Class Material"}*\n\n`;

  // Group key points by topic and preserve all topics
  const topicGroups: Record<string, string[]> = {};
  for (const kp of keyPoints) {
    const t = kp.topic || "Core Concepts";
    if (!topicGroups[t]) topicGroups[t] = [];
    topicGroups[t].push(kp.point);
  }

  // Also collect paragraphs per section/slide
  const sectionChunks: { heading: string; body: string[] }[] = [];
  let curSection = "Comprehensive Class Material";
  let curLines: string[] = [];

  const allLines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of allLines) {
    if (
      line.startsWith("#") ||
      line.startsWith("===") ||
      /^Chapter\s+\d+/i.test(line) ||
      /^Section\s+\d+/i.test(line) ||
      /^Slide\s+\d+/i.test(line) ||
      /^[A-Z0-9\s:,-]{4,40}:$/.test(line)
    ) {
      if (curLines.length > 0) {
        sectionChunks.push({ heading: curSection, body: [...curLines] });
        curLines = [];
      }
      curSection = line.replace(/^[#=]+\s*/, "").replace(/:$/, "").trim();
    } else if (line.length >= 20 && !line.startsWith("http")) {
      curLines.push(line);
    }
  }
  if (curLines.length > 0) {
    sectionChunks.push({ heading: curSection, body: [...curLines] });
  }

  let notesBody = `## Overview & Foundations\n`;
  notesBody += `This comprehensive study guide covers all class material, lectures, readings, and essential concepts extracted from **${title || "the uploaded source document"}**.\n\n`;

  // Key Terminology & Definitions (Cover all extracted definitions)
  if (definitions.length > 0) {
    notesBody += `## Key Terminology & Definitions\n`;
    for (const d of definitions) {
      notesBody += `- **${d.term}** — ${d.definition}\n`;
    }
    notesBody += `\n`;
  }

  // Process all detected structured topics
  const topics = Object.keys(topicGroups);
  if (topics.length > 0) {
    for (const topic of topics) {
      notesBody += `## ${topic}\n`;
      const pts = topicGroups[topic]!;
      for (const pt of pts) {
        notesBody += `- ${pt}\n`;
      }
      notesBody += `\n> **Key Concept:** Practical application, mechanism, and exam considerations for ${topic}.\n\n`;
    }
  } else if (sectionChunks.length > 1) {
    // If structured by chapters/slides/sections, include every section
    for (const sec of sectionChunks) {
      notesBody += `## ${sec.heading}\n`;
      for (const line of sec.body) {
        notesBody += `- ${line}\n`;
      }
      notesBody += `\n`;
    }
  } else {
    // Thorough breakdown of all material paragraphs
    notesBody += `## Detailed Material Breakdown\n`;
    for (const para of rawParagraphs) {
      notesBody += `- ${para}\n\n`;
    }
  }

  // Key Takeaways
  notesBody += `\n## Key Takeaways\n`;
  if (keyPoints.length >= 4) {
    const topPoints = keyPoints.slice(0, 10);
    for (const kp of topPoints) {
      notesBody += `- ${kp.point}\n`;
    }
  } else {
    notesBody += `- Review the primary definitions and terminology identified in the source.\n`;
    notesBody += `- Review the main concepts and relationships extracted from the source material.\n`;
  }

  return titleHeader + notesBody;
}

/**
 * Generates EXACTLY 20 high-value, educational flashcards from the material.
 */
export function generate20Flashcards(material: string, title: string, subject: string): GeneratedFlashcard[] {
  const cleaned = cleanText(material);
  const { definitions, keyPoints } = extractKeyFactsAndDefinitions(cleaned);

  const cards: GeneratedFlashcard[] = [];
  const seenQuestions = new Set<string>();

  const addCard = (q: string, a: string, t: string) => {
    const cleanQ = q.trim();
    const cleanA = a.trim();
    if (!cleanQ || !cleanA || cleanQ.length < 5 || cleanA.length < 5) return false;
    const norm = cleanQ.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenQuestions.has(norm)) return false;
    seenQuestions.add(norm);
    cards.push({
      q: cleanQ,
      a: cleanA,
      t: (t || subject || "Fundamentals").slice(0, 40),
    });
    return true;
  };

  // 1. First add genuine definitions from the material
  for (const def of definitions) {
    if (cards.length >= 20) break;
    addCard(`What is ${def.term}?`, def.definition, def.topic);
    if (cards.length < 20 && def.definition.length > 25) {
      addCard(`Which concept is defined as: "${def.definition.slice(0, 80)}..."?`, def.term, def.topic);
    }
  }

  // 2. Next, generate questions from key points
  for (const kp of keyPoints) {
    if (cards.length >= 20) break;
    const pt = kp.point;

    // Convert informational sentences into testable questions
    if (pt.includes(" because ")) {
      const parts = pt.split(" because ");
      if (parts[0] && parts[1]) {
        addCard(`Why does ${parts[0].trim().toLowerCase()}?`, `Because ${parts[1].trim()}`, kp.topic);
      }
    } else if (pt.includes(" leads to ") || pt.includes(" causes ") || pt.includes(" results in ")) {
      const splitter = pt.includes(" leads to ") ? " leads to " : pt.includes(" causes ") ? " causes " : " results in ";
      const parts = pt.split(splitter);
      if (parts[0] && parts[1]) {
        addCard(`What is the result when ${parts[0].trim().toLowerCase()}?`, `It results in: ${parts[1].trim()}`, kp.topic);
      }
    } else if (pt.length >= 40) {
      addCard(`According to the material, explain: ${pt.slice(0, 60)}...`, pt, kp.topic);
    }
  }

  // 3. Fallback extraction: extract sentence-based questions from source paragraphs
  if (cards.length < 20) {
    const sentences = cleaned
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 35 && s.length <= 180);

    for (let i = 0; i < sentences.length && cards.length < 20; i++) {
      const s = sentences[i]!;
      const words = s.split(" ");
      if (words.length >= 6) {
        const firstFew = words.slice(0, 4).join(" ");
        addCard(`Key Concept #${cards.length + 1}: What is stated regarding "${firstFew}"?`, s, subject || "Core Concept");
      }
    }
  }

  // 4. If material was short, guarantee exactly 20 cards with tailored high-yield review cards
  const standardQuestions = [
    { q: `What is the primary topic covered in ${title || "this study set"}?`, a: `The material centers on ${subject || title || "the core concepts provided in the text"}.`, t: "Core Topic" },
    { q: "What is the recommended approach for reviewing this material?", a: "Consistent active recall, spaced repetition using these flashcards, and testing yourself on key terms.", t: "Study Method" },
    { q: `How does ${subject || "this topic"} connect to broader foundational principles?`, a: `It builds on the essential definitions, cause-and-effect relationships, and practical examples detailed in the notes.`, t: "Synthesis" },
    { q: "What is the key takeaway definition from the introductory section?", a: definitions[0]?.definition || `The primary foundational principle outlined in the text.`, t: "Foundations" },
    { q: "What should you identify when analyzing key exam questions on this topic?", a: "Look for core definitions, underlying mechanisms, and clear distinctions between related terms.", t: "Exam Strategy" },
    { q: "What is the significance of the examples provided in the material?", a: "They illustrate how theoretical principles operate in real-world scenarios and applied contexts.", t: "Application" },
    { q: "What differentiates the main concepts in this set from related topics?", a: "The specific terminology, precise definitions, and contextual criteria outlined in the source notes.", t: "Distinction" },
    { q: "How can you verify mastery of these 20 flashcards?", a: "Being able to recall both the definition and the practical implications without looking at the back of the card.", t: "Self-Testing" },
    { q: "What is the main causal relationship established in the source text?", a: keyPoints[0]?.point || "The foundational relationships and processes explained in the study notes.", t: "Mechanism" },
    { q: "Summarize the overarching conclusion of this study module.", a: `Thorough comprehension of ${title || "the subject"} enables accurate recall and practical mastery.`, t: "Conclusion" },
  ];

  for (const sq of standardQuestions) {
    if (cards.length >= 20) break;
    addCard(sq.q, sq.a, sq.t);
  }

  // Fill up to exactly 20 if still under
  while (cards.length < 20) {
    const idx = cards.length + 1;
    addCard(
      `Review Check #${idx}: What is an essential fact from ${title || "this material"}?`,
      keyPoints[idx % (keyPoints.length || 1)]?.point || `Ensure thorough understanding of the principles discussed in ${title || "the study set"}.`,
      "Review & Recall",
    );
  }

  return cards.slice(0, 20);
}

/**
 * Main generator: returns clean markdown notes and exactly 20 flashcards.
 */
export function generateStudySetContent(materialText: string, title: string, subject: string): GeneratedStudySet {
  const notes = generateNotesFromMaterial(materialText, title, subject);
  const cards = generate20Flashcards(materialText, title, subject);
  return { notes, cards };
}
