// Browser-only text extraction for uploaded study files.
import { supabase } from "@/integrations/supabase/client";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const ACCEPT = [
  "application/pdf", ".pdf",
  DOCX, ".docx",
  PPTX, ".pptx",
  "text/plain", ".txt", ".md", ".markdown",
  ...IMAGE_TYPES, ".png", ".jpg", ".jpeg", ".webp",
].join(",");
// Per-file client-side reading upload cap. Keep UI copy and validation aligned.
export const MAX_BYTES = 100 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_BYTES = 16 * 1024 * 1024;
export const EXTRACTION_VERSION = 1;
const MAX_HASHED_FILE_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_TEXT_CHARS = 1_000_000;
const QUIZ_VISUAL_CACHE_CONTEXT = "quiz-visual-assets-v1";

export type CachedExtractionResult = {
  text: string;
  fileSha256: string | null;
  cacheHit: boolean;
  visualDescriptions: { location: string; description: string }[];
};

async function sha256Bytes(bytes: ArrayBuffer): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function sha256Text(value: string): Promise<string | null> {
  return sha256Bytes(new TextEncoder().encode(value).buffer as ArrayBuffer);
}

export async function fileSha256(file: File): Promise<string | null> {
  if (file.size > MAX_HASHED_FILE_BYTES) return null;
  return sha256Bytes(await file.arrayBuffer());
}

function findVisualDescriptions(text: string) {
  const matches = text.matchAll(/### Figure\/diagram reference \((Page|Slide) ([^)]+)\)\s*\n([\s\S]*?)(?=\n### Figure\/diagram reference \(|\n## Page \d+\s*\n|$)/g);
  return Array.from(matches, (match) => ({
    location: `${match[1]} ${match[2]}`,
    description: (match[3] ?? "").replace(/\n\n\*\*Lecture connection:\*\*[\s\S]*$/, "").trim(),
  })).filter((item) => item.description);
}

export function fileKind(f: File): "pdf" | "docx" | "pptx" | "txt" | "image" | null {
  // Prefer the filename extension as browser MIME types are sometimes blank or incorrect,
  // especially for PDFs downloaded from school portals and Markdown files.
  const n = f.name.trim().toLowerCase();
  if (n.endsWith(".pdf") || f.type.toLowerCase() === "application/pdf") return "pdf";
  if (n.endsWith(".docx") || f.type.toLowerCase() === DOCX) return "docx";
  if (n.endsWith(".pptx") || f.type.toLowerCase() === PPTX) return "pptx";
  if ([".txt", ".md", ".markdown"].some((ext) => n.endsWith(ext)) || f.type.toLowerCase().startsWith("text/")) return "txt";
  if ([".png", ".jpg", ".jpeg", ".webp"].some((ext) => n.endsWith(ext)) || IMAGE_TYPES.includes(f.type.toLowerCase())) return "image";
  return null;
}

function readDataUrl(blob: Blob) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Couldn't read file"));
    r.readAsDataURL(blob);
  });
}

async function shrinkImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser couldn't prepare the lecture image.");
    context.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bmp.close();
  }
}

function meaningfulWordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]{2,}/gu) ?? []).length;
}

function looksLikePdfHeadingsOnly(text: string): boolean {
  const cleaned = text.replace(/^\s*##\s*(?:Page|পৃষ্ঠা)\s+\d+\s*$/gim, "").trim();
  const words = meaningfulWordCount(cleaned);
  if (words < 35) return true;
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const shortLines = lines.filter((line) => meaningfulWordCount(line) <= 5).length;
  return lines.length >= 8 && shortLines / lines.length > 0.82 && words < lines.length * 5;
}

async function extractPdf(file: File): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: false });
    let result = Array.isArray(text)
      ? text.map((page, i) => `## Page ${i + 1}\n${page}`).join("\n\n")
      : text;

    // Some selectable-text PDFs use unusual font encodings or text-item ordering.
    // The convenience extractor can then return only running headers/page labels
    // even though the PDF contains body text. Re-read each page directly before
    // concluding that the file has no usable text.
    if (!result || looksLikePdfHeadingsOnly(result)) {
      const pages: string[] = [];
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        const items = content.items as Array<{ str?: string; hasEOL?: boolean }>;
        let pageText = "";
        for (const item of items) {
          const value = item.str ?? "";
          if (!value) continue;
          pageText += value;
          pageText += item.hasEOL ? "\n" : " ";
        }
        pages.push(`## Page ${pageNo}\n${pageText.trim()}`);
      }
      const directResult = pages.join("\n\n").trim();
      if (directResult && (!result || meaningfulWordCount(directResult) > meaningfulWordCount(result))) {
        result = directResult;
      }
    }
    if (result && result.trim().length > 10) return result.trim();
  } catch (err) {
    console.warn("unpdf extraction failed, attempting raw text stream recovery:", err);
  }

  // Fallback: extract plain text strings from PDF binary stream
  try {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder("latin1");
    const content = decoder.decode(buffer);
    const matches = content.match(/\(([^()]{3,})\)Tj/g) || content.match(/BT[\s\S]*?ET/g);
    if (matches && matches.length > 0) {
      const extracted = matches
        .map((m) => m.replace(/[()Tj]|BT|ET/g, " ").trim())
        .filter((s) => s.length > 2)
        .join(" ");
      if (extracted.length > 20) return extracted;
    }
  } catch {
    // ignore
  }
  return "";
}

async function extractDocx(file: File) {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  // Mammoth's browser build accepts arrayBuffer while its Node build accepts
  // buffer. Supplying both lets bundlers and test runners resolve either build.
  const { value } = await mammoth.extractRawText({
    arrayBuffer,
    buffer: new Uint8Array(arrayBuffer),
  } as Parameters<typeof mammoth.extractRawText>[0]);
  return value;
}

async function extractPptx(file: File, ocr: Ocr, onMsg: (m: string) => void, includeVisualDescriptions = true) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  let visualsAnalyzed = 0;
  // Keep visual interpretation bounded while sampling more than just the opening slides.
  // A hard cap prevents decks with many decorative images from triggering unbounded calls.
  for (const [i, p] of slides.entries()) {
    const xml = await zip.file(p)!.async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const paras = Array.from(doc.getElementsByTagName("a:p"))
      .map((para) =>
        Array.from(para.getElementsByTagName("a:t"))
          .map((t) => t.textContent ?? "")
          .join(""),
      )
      .filter((t) => t.trim());
    const notesPath = `ppt/notesSlides/notesSlide${p.match(/\d+/)![0]}.xml`;
    let notes = "";
    if (zip.file(notesPath)) {
      const nd = new DOMParser().parseFromString(
        await zip.file(notesPath)!.async("string"),
        "application/xml",
      );
      notes = Array.from(nd.getElementsByTagName("a:t"))
        .map((t) => t.textContent ?? "")
        .join(" ")
        .trim();
    }
    const slideText = `## Slide ${i + 1}\n${paras.join("\n")}${notes ? `\nSpeaker notes: ${notes}` : ""}`;
    const slideOutputIndex = out.length;
    if (paras.length || notes) out.push(slideText);

    // PowerPoint keeps pictures separately from slide text. Follow the slide's
    // relationship references so diagrams are described in the context of the slide.
    if (includeVisualDescriptions && i < 40 && visualsAnalyzed < 8) {
      const slideNumber = p.match(/slide(\d+)\.xml$/)?.[1];
      const relsPath = slideNumber ? `ppt/slides/_rels/slide${slideNumber}.xml.rels` : "";
      const relsFile = relsPath ? zip.file(relsPath) : null;
      if (relsFile) {
        try {
          const relsDoc = new DOMParser().parseFromString(await relsFile.async("string"), "application/xml");
          const relationships = Array.from(relsDoc.getElementsByTagName("Relationship"));
          const byId = new Map(relationships.map((rel) => [
            rel.getAttribute("Id") ?? "",
            rel.getAttribute("Target") ?? "",
          ]));
          const slideDoc = new DOMParser().parseFromString(xml, "application/xml");
          const blips = Array.from(slideDoc.getElementsByTagName("a:blip"));
          for (const blip of blips.slice(0, 3)) {
            if (visualsAnalyzed >= 8) break;
            const relId = blip.getAttribute("r:embed") ?? blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
            const target = relId ? byId.get(relId) : "";
            if (!target || target.startsWith("http")) continue;
            const imagePath = (`ppt/slides/${target}`).replace(/\\/g, "/").split("/").reduce<string[]>((parts, part) => {
              if (!part || part === ".") return parts;
              if (part === "..") parts.pop(); else parts.push(part);
              return parts;
            }, []).join("/");
            const imageFile = zip.file(imagePath);
            if (!imageFile || !/^ppt\/media\//.test(imagePath)) continue;
            const ext = imagePath.split(".").pop()?.toLowerCase() ?? "png";
            if (!["png", "jpg", "jpeg", "webp"].includes(ext)) continue;
            const mediaType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
            try {
              visualsAnalyzed += 1;
              onMsg(`Analyzing visual on slide ${i + 1} of ${file.name}…`);
              const imageBlob = await imageFile.async("blob");
              const imageFileForVision = new File([imageBlob], `${file.name}-slide-${i + 1}.${ext}`, { type: mediaType });
              const imageData = await shrinkImage(imageFileForVision);
              const result = await ocr({ data: {
                data: imageData,
                mediaType: "image/jpeg",
                filename: `${file.name} — slide ${i + 1} visual`,
                task: "describe_visuals",
                context: `${file.name} — slide ${i + 1} text:\n${slideText.slice(0, 12000)}`,
              }});
              const description = result.text.trim();
              if (description && !/^no meaningful visual content detected\.?$/i.test(description)) {
                const visualReference = `\n\n### Figure/diagram reference (Slide ${i + 1})\n${description}\n\n**Lecture connection:** Interpret this visual alongside the text and speaker notes on Slide ${i + 1}; use its labels, arrows, axes, or parts to clarify the concept being taught.`;
                if (slideOutputIndex < out.length) {
                  out[slideOutputIndex] += visualReference;
                } else {
                  out.push(`## Slide ${i + 1}${visualReference}`);
                }
              }
            } catch (error) {
              console.warn(`Could not analyze a visual on slide ${i + 1}.`, error);
            }
          }
        } catch (error) {
          console.warn(`Could not inspect image relationships on slide ${i + 1}.`, error);
        }
      }
    }
  }
  if (includeVisualDescriptions && (slides.length > 40 || visualsAnalyzed >= 8)) {
    out.push("[Visual analysis was capped at eight embedded images across the first 40 slides. Slide text and speaker notes were still extracted from the full presentation.]");
  }
  return out.join("\n\n");
}

type Ocr = (args: {
  data: {
    data: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp";
    filename: string;
    task?: "transcribe" | "describe_visuals";
    context?: string;
  };
}) => Promise<{ text: string }>;

async function pdfPageCountHint(file: File): Promise<number> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    return pdf.numPages;
  } catch {
    return 0;
  }
}

async function renderPdfPages(file: File, maxPages = 20, sampleAcrossDocument = false): Promise<Array<{ page: number; data: string }>> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const pages: Array<{ page: number; data: string }> = [];
  const pageCount = Math.min(pdf.numPages, maxPages);
  const pageNumbers = sampleAcrossDocument && pdf.numPages > pageCount
    ? [...new Set(Array.from({ length: pageCount }, (_, index) =>
        Math.round(1 + (index * (pdf.numPages - 1)) / Math.max(1, pageCount - 1)),
      ))]
    : Array.from({ length: pageCount }, (_, index) => index + 1);
  for (const pageNo of pageNumbers) {
    const page = await pdf.getPage(pageNo) as any;
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser couldn't prepare PDF pages for visual analysis.");
    await page.render({ canvasContext: context, viewport }).promise;
    pages.push({ page: pageNo, data: canvas.toDataURL("image/jpeg", 0.82) });
    canvas.width = 0;
    canvas.height = 0;
  }
  return pages;
}

export type QuizVisual = { data: string; name: string; kind: "image" | "pdf" | "pptx" | "docx"; sourceIndex: number };

async function compactQuizVisual(data: string): Promise<string> {
  const response = await fetch(data);
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser couldn't prepare the lecture visual.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.68);
}

/** Extract a small, reproducible set of real visuals from a saved upload for optional image quizzes. */
export async function extractQuizVisuals(file: File, limit = 3): Promise<QuizVisual[]> {
  const kind = fileKind(file);
  if (kind === "image") return [{ data: await compactQuizVisual(await shrinkImage(file)), name: file.name, kind: "image", sourceIndex: 0 }];
  if (kind === "pdf") {
    if (file.size > MAX_BYTES) return [];
    const pages = await renderPdfPages(file, Math.max(1, Math.min(limit, 3)), true);
    const visuals: QuizVisual[] = [];
    for (const page of pages) visuals.push({ data: await compactQuizVisual(page.data), name: `${file.name} — page ${page.page}`, kind: "pdf", sourceIndex: page.page });
    return visuals;
  }
  if (kind === "docx") {
    if (file.size > MAX_BYTES) return [];
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const documentFile = zip.file("word/document.xml");
    const relsFile = zip.file("word/_rels/document.xml.rels");
    if (!documentFile || !relsFile) return [];
    const document = new DOMParser().parseFromString(await documentFile.async("string"), "application/xml");
    const relationships = new DOMParser().parseFromString(await relsFile.async("string"), "application/xml");
    const imageTargets = new Map(Array.from(relationships.getElementsByTagName("Relationship"))
      .filter((rel) => (rel.getAttribute("Type") ?? "").endsWith("/image"))
      .map((rel) => [rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? ""]));
    const referenced = Array.from(document.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip"))
      .map((blip) => blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed"))
      .filter((id): id is string => Boolean(id))
      .map((id) => imageTargets.get(id) ?? "")
      .filter((target) => Boolean(target) && !target.startsWith("http"))
      .map((target) => target.startsWith("/") ? target.slice(1) : `word/${target}`)
      .map((path) => path.replace(/\\/g, "/").split("/").reduce<string[]>((parts, part) => {
        if (!part || part === ".") return parts;
        if (part === "..") parts.pop(); else parts.push(part);
        return parts;
      }, []).join("/"))
      .filter((path, index, paths) => path.startsWith("word/media/") && paths.indexOf(path) === index)
      .slice(0, Math.max(0, Math.min(limit, 10)));
    const visuals: QuizVisual[] = [];
    for (const [index, path] of referenced.entries()) {
      const image = zip.file(path);
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (!image || !["png", "jpg", "jpeg", "webp"].includes(ext)) continue;
      const estimatedSize = (image as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (estimatedSize != null && estimatedSize > MAX_EMBEDDED_IMAGE_BYTES) continue;
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
      try {
        const blob = await image.async("blob");
        const visualFile = new File([blob], `${file.name}-image-${index + 1}.${ext}`, { type: mime });
        const data = await compactQuizVisual(await shrinkImage(visualFile));
        visuals.push({ data, name: `${file.name} — image ${index + 1}`, kind: "docx", sourceIndex: visuals.length });
      } catch (error) {
        console.warn(`Could not prepare an embedded visual from ${file.name}.`, error);
      }
    }
    return visuals;
  }
  if (kind !== "pptx") return [];
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const visuals: QuizVisual[] = [];
  let sourceIndex = 0;
  for (const [slideIndex, path] of slides.entries()) {
    if (slideIndex >= 40 || visuals.length >= limit) break;
    const slideNumber = path.match(/slide(\d+)\.xml$/)?.[1];
    if (!slideNumber) continue;
    try {
      const slideXml = await zip.file(path)!.async("string");
      const slide = new DOMParser().parseFromString(slideXml, "application/xml");
      const relsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
      const relsFile = zip.file(relsPath);
      if (!relsFile) continue;
      const rels = new DOMParser().parseFromString(await relsFile.async("string"), "application/xml");
      const byId = new Map(Array.from(rels.getElementsByTagName("Relationship")).map((rel) => [rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? ""]));
      for (const blip of Array.from(slide.getElementsByTagName("a:blip")).slice(0, 3)) {
        if (visuals.length >= limit) break;
        const relId = blip.getAttribute("r:embed") ?? blip.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
        const target = relId ? byId.get(relId) : "";
        if (!target || target.startsWith("http")) continue;
        const imagePath = (`ppt/slides/${target}`).replace(/\\/g, "/").split("/").reduce<string[]>((parts, part) => {
          if (!part || part === ".") return parts;
          if (part === "..") parts.pop(); else parts.push(part);
          return parts;
        }, []).join("/");
        const imageFile = zip.file(imagePath);
        const ext = imagePath.split(".").pop()?.toLowerCase() ?? "";
        if (!imageFile || !/^ppt\/media\//.test(imagePath) || !["png", "jpg", "jpeg", "webp"].includes(ext)) continue;
        const estimatedSize = (imageFile as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
        if (estimatedSize != null && estimatedSize > MAX_EMBEDDED_IMAGE_BYTES) continue;
        const currentIndex = sourceIndex++;
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        const imageBlob = await imageFile.async("blob");
        const imageData = await compactQuizVisual(await shrinkImage(new File([imageBlob], `${file.name}-slide-${slideNumber}.${ext}`, { type: mime })));
        visuals.push({ data: imageData, name: `${file.name} — slide ${slideNumber}`, kind: "pptx", sourceIndex: currentIndex });
      }
    } catch (error) {
      console.warn(`Could not extract an embedded visual from slide ${slideNumber}.`, error);
    }
  }
  return visuals;
}

type CachedQuizVisual = { path: string; name: string; kind: QuizVisual["kind"]; sourceIndex: number };

function dataUrlToBlob(data: string): Blob | null {
  const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match?.[1]) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: data.slice(5, data.indexOf(";")) });
}

/** Returns cached quiz image data, or null when this file has not been cached. */
export async function loadCachedQuizVisuals(
  userId: string,
  sourceSha256: string,
  limit = 3,
): Promise<QuizVisual[] | null> {
  const contextSha256 = await sha256Text(QUIZ_VISUAL_CACHE_CONTEXT);
  if (!contextSha256) return null;
  try {
    const { data, error } = await supabase
      .from("study_file_extractions")
      .select("visual_assets")
      .eq("user_id", userId)
      .eq("file_sha256", sourceSha256)
      .eq("extraction_version", EXTRACTION_VERSION)
      .eq("context_sha256", contextSha256)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error || !data || !Array.isArray(data["visual_assets"])) return null;
    const assets = data["visual_assets"].filter((asset): asset is CachedQuizVisual =>
      !!asset && typeof asset === "object" &&
      "path" in asset && typeof asset["path"] === "string" &&
      "name" in asset && typeof asset["name"] === "string" &&
      "kind" in asset && ["image", "pdf", "pptx", "docx"].includes(String(asset["kind"])) &&
      "sourceIndex" in asset && Number.isInteger(asset["sourceIndex"]),
    ).slice(0, limit);
    const visuals: QuizVisual[] = [];
    for (const asset of assets) {
      const { data: blob, error: downloadError } = await supabase.storage.from("study-files").download(asset["path"]);
      if (downloadError || !blob) return null;
      visuals.push({ data: await readDataUrl(blob), name: asset["name"], kind: asset["kind"], sourceIndex: asset["sourceIndex"] });
    }
    return visuals;
  } catch {
    return null;
  }
}

/** Write a private visual cache object without requiring Storage UPDATE permission. */
export async function uploadQuizCacheAsset(
  upload: () => Promise<{ error: { message?: string } | null }>,
  confirmExisting: () => Promise<boolean>,
): Promise<boolean> {
  const { error } = await upload();
  if (!error) return true;
  if (await confirmExisting()) return false;
  throw error;
}

/** Extracts quiz images once and stores private compressed copies for reuse. */
export async function extractQuizVisualsCached(
  file: File,
  userId: string,
  limit = 3,
  knownSha256?: string | null,
): Promise<{ visuals: QuizVisual[]; fileSha256: string | null; cacheHit: boolean }> {
  const sourceSha256 = knownSha256 ?? await fileSha256(file);
  if (!sourceSha256) return { visuals: await extractQuizVisuals(file, limit), fileSha256: null, cacheHit: false };
  const cached = await loadCachedQuizVisuals(userId, sourceSha256, limit);
  if (cached) return { visuals: cached, fileSha256: sourceSha256, cacheHit: true };

  const visuals = await extractQuizVisuals(file, limit);
  const contextSha256 = await sha256Text(QUIZ_VISUAL_CACHE_CONTEXT);
  if (!contextSha256) return { visuals, fileSha256: sourceSha256, cacheHit: false };
  const uploaded: string[] = [];
  const assets: CachedQuizVisual[] = [];
  try {
    for (const [index, visual] of visuals.entries()) {
      const blob = dataUrlToBlob(visual.data);
      if (!blob) throw new Error("Could not prepare a cached quiz image.");
      const path = `${userId}/_engine-cache/${sourceSha256}/v${EXTRACTION_VERSION}/quiz-${index + 1}.jpg`;
      const storage = supabase.storage.from("study-files");
      // The cache path is deterministic for this content hash/version. Reuse an
      // existing private object after confirming SELECT access; never require
      // UPDATE permission just to refresh cache metadata.
      const created = await uploadQuizCacheAsset(
        () => storage.upload(path, blob, { contentType: "image/jpeg" }),
        async () => {
          const { data: existing, error: lookupError } = await storage.createSignedUrl(path, 60);
          return !lookupError && Boolean(existing?.signedUrl);
        },
      );
      if (created) uploaded.push(path);
      assets.push({ path, name: visual.name, kind: visual.kind, sourceIndex: visual.sourceIndex });
    }
    const { error } = await supabase.from("study_file_extractions").upsert({
      user_id: userId,
      file_sha256: sourceSha256,
      extraction_version: EXTRACTION_VERSION,
      context_sha256: contextSha256,
      extracted_text: "",
      visual_descriptions: [],
      visual_assets: assets,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "user_id,file_sha256,extraction_version,context_sha256" });
    if (error) throw error;
  } catch {
    if (uploaded.length) await supabase.storage.from("study-files").remove(uploaded).catch(() => undefined);
  }
  return { visuals, fileSha256: sourceSha256, cacheHit: false };
}

export async function extractFile(f: File, ocr: Ocr, onMsg: (m: string) => void, lectureContext = "", includeVisualDescriptions = true): Promise<string> {
  const kind = fileKind(f);
  if (kind === "pdf") {
    onMsg(`Reading ${f.name}…`);
    let text = (await extractPdf(f)).trim();
    const hasReadableExtractedText = Boolean(text) && !looksLikePdfHeadingsOnly(text);
    // A PDF can contain page labels/headings but no body text. Treat that as a
    // failed extraction and try OCR instead of saving misleadingly empty context.
    if (text.length < 30 || looksLikePdfHeadingsOnly(text)) {
      if (f.size > MAX_BYTES) {
        throw new Error(`${f.name} is too large for OCR processing. Try a text-searchable PDF or split it into smaller parts before uploading.`);
      }
      try {
        onMsg(`Text extraction was sparse. Rendering pages for text and visual recognition in ${f.name}…`);
        const pages = await renderPdfPages(f, 20);
        const recognized: string[] = [];
        for (const page of pages) {
          const result = await ocr({ data: {
            data: page.data,
            mediaType: "image/jpeg",
            filename: `${f.name} — page ${page.page}`,
            context: lectureContext.slice(0, 12000),
          }});
          if (result.text.trim()) recognized.push(`## Page ${page.page}\n${result.text.trim()}`);
        }
        const ocrText = recognized.join("\n\n").trim();
        // Keep the better extraction, and preserve the page numbers for source reference.
        if (ocrText && (looksLikePdfHeadingsOnly(text) || meaningfulWordCount(ocrText) > meaningfulWordCount(text))) {
          text = ocrText;
        }
        if (await pdfPageCountHint(f) > pages.length) {
          text += `\n\n[Visual/OCR analysis was limited to the first ${pages.length} pages of this PDF; the remaining pages were not image-analyzed.]`;
        }
      } catch (err) {
        console.warn("OCR fallback was unavailable for scanned or image-based PDF.", err);
      }
    }
    if (looksLikePdfHeadingsOnly(text)) {
      throw new Error(`${f.name}: Momentum could only read page headings, not the actual page text. Try downloading an OCR/text-searchable version of the PDF, or split the file into smaller parts and retry.`);
    }
    // Text extraction misses figures in otherwise searchable PDFs. Ask the vision
    // model to describe visual elements separately and ground them in nearby text.
    if (hasReadableExtractedText && includeVisualDescriptions) {
      try {
        onMsg(`Checking a small sample of pages for lecture figures in ${f.name}…`);
        // Sample up to six pages evenly across the document. Full-page visual analysis
        // across every page is slow and costly; text extraction still covers the whole file.
        const pages = await renderPdfPages(f, 6, true);
        const visualNotes: Array<{ page: number; description: string }> = [];
        for (const page of pages) {
          const pageMatch = text.match(new RegExp(`## Page ${page.page}\\s*([\\s\\S]*?)(?=\\n## Page \\d+|$)`, "i"));
          const pageContext = pageMatch?.[1]?.trim() || text.slice(0, 12000);
          const visuals = await ocr({ data: {
            data: page.data,
            mediaType: "image/jpeg",
            filename: `${f.name} — page ${page.page}`,
            task: "describe_visuals",
            context: pageContext.slice(0, 12000),
          }});
          const description = visuals.text.trim();
          if (description && !/^no meaningful visual content detected\\.?$/i.test(description)) {
            visualNotes.push({ page: page.page, description });
          }
        }
        for (const visual of visualNotes) {
          const pageHeading = new RegExp(`(^## Page ${visual.page}\\s*$[\\s\\S]*?)(?=^## Page \\d+\\s*$|$)`, "im");
          const reference = `\n\n### Figure/diagram reference (Page ${visual.page})\n${visual.description}\n\n**Lecture connection:** Read this visual together with the surrounding explanation on Page ${visual.page}; use its labels, arrows, axes, or parts to understand the concept being taught.`;
          if (pageHeading.test(text)) text = text.replace(pageHeading, (_match, section) => `${section}${reference}`);
          else text = `${text.trim()}\n\n## Page ${visual.page}\n${reference}`;
        }
        if (await pdfPageCountHint(f) > pages.length) {
          text += `\n\n[Visual references are based on a sample of pages ${pages.map((page) => page.page).join(", ")}; text from the full PDF was still extracted.]`;
        }
      } catch (err) {
        console.warn(`Visual analysis was unavailable for ${f.name}.`, err);
      }
    }
    return text.trim();
  }
  if (kind === "docx") {
    onMsg(`Reading ${f.name}…`);
    return (await extractDocx(f)).trim();
  }
  if (kind === "pptx") {
    onMsg(`Reading slides and finding diagrams in ${f.name}…`);
    return (await extractPptx(f, ocr, onMsg, includeVisualDescriptions)).trim();
  }
  if (kind === "txt") return (await f.text()).trim();
  if (kind === "image") {
    onMsg(`Running OCR on ${f.name}…`);
    return (
      await ocr({ data: {
        data: await shrinkImage(f),
        mediaType: "image/jpeg",
        filename: f.name,
        task: "transcribe",
        context: lectureContext.slice(0, 12000),
      } })
    ).text.trim();
  }
  throw new Error(`${f.name} isn't a supported file type.`);
}

/** Reuse successful extraction for identical file bytes, version and OCR context. */
export async function extractFileCached(
  file: File,
  userId: string | undefined,
  ocr: Ocr,
  onMsg: (message: string) => void,
  lectureContext = "",
  includeVisualDescriptions = true,
): Promise<CachedExtractionResult> {
  const fileHash = await fileSha256(file);
  const contextSha256 = await sha256Text(lectureContext);
  if (!userId || !fileHash || !contextSha256) {
    const text = await extractFile(file, ocr, onMsg, lectureContext, includeVisualDescriptions);
    return { text, fileSha256: fileHash, cacheHit: false, visualDescriptions: findVisualDescriptions(text) };
  }

  try {
    const { data, error } = await supabase
      .from("study_file_extractions")
      .select("extracted_text,visual_descriptions")
      .eq("user_id", userId)
      .eq("file_sha256", fileHash)
      .eq("extraction_version", EXTRACTION_VERSION)
      .eq("context_sha256", contextSha256)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!error && data?.extracted_text) {
      const visualDescriptions = Array.isArray(data.visual_descriptions)
        ? data["visual_descriptions"].filter((item): item is { location: string; description: string } =>
            !!item && typeof item === "object" && "location" in item && typeof item["location"] === "string" && "description" in item && typeof item["description"] === "string",
          )
        : [];
      onMsg(`Reused saved extraction for ${file.name}.`);
      return { text: data["extracted_text"], fileSha256: fileHash, cacheHit: true, visualDescriptions };
    }
  } catch {
    // The cache is an optimization. If its optional migration has not been
    // applied or the service is unavailable, normal extraction still works.
  }

  const text = await extractFile(file, ocr, onMsg, lectureContext, includeVisualDescriptions);
  const visualDescriptions = findVisualDescriptions(text);
  if (text && text.length <= MAX_CACHED_TEXT_CHARS) {
    try {
      await supabase.from("study_file_extractions").upsert({
        user_id: userId,
        file_sha256: fileHash,
        extraction_version: EXTRACTION_VERSION,
        context_sha256: contextSha256,
        extracted_text: text,
        visual_descriptions: visualDescriptions,
        visual_assets: [],
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "user_id,file_sha256,extraction_version,context_sha256" });
    } catch {
      // A failed optional cache write must not discard successfully extracted text.
    }
  }
  return { text, fileSha256: fileHash, cacheHit: false, visualDescriptions };
}

/** Keeps the original file attached to the study set (private storage). Failures are reported but non-fatal. */
export async function storeOriginal(userId: string, setId: string, f: File, chars: number, knownSha256?: string | null) {
  const path = `${userId}/${setId}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
  const contentSha256 = knownSha256 ?? await fileSha256(f);
  const { error } = await supabase.storage
    .from("study-files")
    .upload(path, f, { contentType: f.type || "application/octet-stream" });
  if (error) return false;
  const { error: metadataError } = await supabase
    .from("study_files")
    .insert({
      set_id: setId,
      user_id: userId,
      path,
      name: f.name,
      mime: f.type,
      size: f.size,
      chars,
      ...(contentSha256 ? { content_sha256: contentSha256 } : {}),
    });
  if (metadataError) {
    // Avoid leaving an untracked private-storage object if metadata persistence fails.
    await supabase.storage.from("study-files").remove([path]);
    return false;
  }
  return true;
}
