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
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
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
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value;
}

async function extractPptx(file: File, ocr: Ocr, onMsg: (m: string) => void) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  let visualsAnalyzed = 0;
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
    if (paras.length || notes) out.push(slideText);

    // PowerPoint keeps pictures separately from slide text. Follow the slide's
    // relationship references so diagrams are described in the context of the slide.
    if (i < 20 && visualsAnalyzed < 12) {
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
          for (const blip of blips.slice(0, 6)) {
            if (visualsAnalyzed >= 12) break;
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
                out.push(`## Slide ${i + 1} — Visual explanation\n${description}`);
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

async function renderPdfPages(file: File, maxPages = 20): Promise<Array<{ page: number; data: string }>> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const pages: Array<{ page: number; data: string }> = [];
  const pageCount = Math.min(pdf.numPages, maxPages);
  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
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

export async function extractFile(f: File, ocr: Ocr, onMsg: (m: string) => void, lectureContext = ""): Promise<string> {
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
    if (hasReadableExtractedText) {
      try {
        onMsg(`Analyzing diagrams and figures in ${f.name}…`);
        const pages = await renderPdfPages(f, 20);
        const visualNotes: string[] = [];
        for (const page of pages) {
          // Keep page-specific extracted text as the grounding context when available.
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
          if (description && !/^no meaningful visual content detected\.?$/i.test(description)) {
            visualNotes.push(`### Page ${page.page}\n${description}`);
          }
        }
        if (visualNotes.length) text = `${text.trim()}\n\n## Visual explanations for figures and diagrams\n${visualNotes.join("\n\n")}`;
        if (await pdfPageCountHint(f) > pages.length) {
          text += `\n\n[Visual analysis was limited to the first ${pages.length} pages of this PDF; the remaining pages' figures may not be described.]`;
        }
      } catch (err) {
        // Keep successfully extracted lecture text if visual analysis is unavailable.
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
    return (await extractPptx(f, ocr, onMsg)).trim();
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

/** Keeps the original file attached to the study set (private storage). Failures are reported but non-fatal. */
export async function storeOriginal(userId: string, setId: string, f: File, chars: number) {
  const path = `${userId}/${setId}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
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
    });
  if (metadataError) {
    // Avoid leaving an untracked private-storage object if metadata persistence fails.
    await supabase.storage.from("study-files").remove([path]);
    return false;
  }
  return true;
}
