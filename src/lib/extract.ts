// Browser-only text extraction for uploaded study files.
import { supabase } from "@/integrations/supabase/client";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const ACCEPT = [
  "application/pdf",
  DOCX,
  PPTX,
  "text/plain",
  ".txt",
  ".md",
  ".docx",
  ".pptx",
  ...IMAGE_TYPES,
].join(",");
export const MAX_BYTES = 20 * 1024 * 1024;

export function fileKind(f: File): "pdf" | "docx" | "pptx" | "txt" | "image" | null {
  const n = f.name.toLowerCase();
  if (f.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (f.type === DOCX || n.endsWith(".docx")) return "docx";
  if (f.type === PPTX || n.endsWith(".pptx")) return "pptx";
  if (f.type.startsWith("text/") || n.endsWith(".txt") || n.endsWith(".md")) return "txt";
  if (IMAGE_TYPES.includes(f.type)) return "image";
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

async function extractPdf(file: File): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: false });
    const result = Array.isArray(text)
      ? text.map((page, i) => `## Page ${i + 1}\n${page}`).join("\n\n")
      : text;
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

async function extractPptx(file: File) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
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
    if (paras.length || notes)
      out.push(`## Slide ${i + 1}\n${paras.join("\n")}${notes ? `\nSpeaker notes: ${notes}` : ""}`);
  }
  return out.join("\n\n");
}

type Ocr = (args: {
  data: { data: string; mediaType: "application/pdf" | "image/jpeg"; filename: string };
}) => Promise<{ text: string }>;

export async function extractFile(f: File, ocr: Ocr, onMsg: (m: string) => void): Promise<string> {
  const kind = fileKind(f);
  if (kind === "pdf") {
    onMsg(`Reading ${f.name}…`);
    let text = (await extractPdf(f)).trim();
    if (text.length < 30) {
      if (f.size > 10 * 1024 * 1024)
        throw new Error(`${f.name} looks scanned and is over 10MB — split it to run OCR.`);
      try {
        onMsg(`Running OCR on ${f.name}…`);
        const ocrResult = await ocr({
          data: { data: await readDataUrl(f), mediaType: "application/pdf", filename: f.name },
        });
        if (ocrResult?.text?.trim()) {
          text = ocrResult.text.trim();
        }
      } catch {
        console.warn("OCR fallback was unavailable for scanned PDF.");
      }
    }
    return text.trim();
  }
  if (kind === "docx") {
    onMsg(`Reading ${f.name}…`);
    return (await extractDocx(f)).trim();
  }
  if (kind === "pptx") {
    onMsg(`Reading slides in ${f.name}…`);
    return (await extractPptx(f)).trim();
  }
  if (kind === "txt") return (await f.text()).trim();
  if (kind === "image") {
    onMsg(`Running OCR on ${f.name}…`);
    return (
      await ocr({ data: { data: await shrinkImage(f), mediaType: "image/jpeg", filename: f.name } })
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
  await supabase
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
  return true;
}
