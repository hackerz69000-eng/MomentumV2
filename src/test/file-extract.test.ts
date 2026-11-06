import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { extractFile, fileKind } from "@/lib/extract";

describe("lecture upload extraction", () => {
  it("recognizes and extracts a text lecture without calling OCR", async () => {
    const file = new File(["ignored"], "week-1.txt", { type: "text/plain" });
    Object.defineProperty(file, "text", { value: async () => "  Lecture headings and key concepts.  " });
    const ocr = vi.fn();
    expect(fileKind(file)).toBe("txt");
    await expect(extractFile(file, ocr, vi.fn())).resolves.toBe("Lecture headings and key concepts.");
    expect(ocr).not.toHaveBeenCalled();
  });

  it("extracts Word lecture paragraphs into studyable text", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Lecture topic: cell structure</w:t></w:r></w:p><w:p><w:r><w:t>Membranes control transport.</w:t></w:r></w:p></w:body></w:document>');
    const archive = await zip.generateAsync({ type: "uint8array" });
    const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
    const file = new File([new Uint8Array(buffer)], "lecture.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => buffer });
    const ocr = vi.fn();

    expect(fileKind(file)).toBe("docx");
    const text = await extractFile(file, ocr, vi.fn());
    expect(text).toContain("Lecture topic: cell structure");
    expect(text).toContain("Membranes control transport.");
    expect(ocr).not.toHaveBeenCalled();
  });

  it("rejects highly compressed Office archives before document extraction", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<document>${"repeated text ".repeat(50_000)}</document>`);
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const buffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
    const file = new File([new Uint8Array(buffer)], "compressed.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => buffer });
    await expect(extractFile(file, vi.fn(), vi.fn())).rejects.toThrow(/expands beyond the safe extraction limit/i);
  });
});
