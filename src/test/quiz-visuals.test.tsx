import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";

const createSignedUrl = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrl, download: vi.fn() }) } },
}));

import { extractQuizVisuals } from "@/lib/extract";
import { QuizQuestionImage } from "@/components/set/QuizRunner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  createSignedUrl.mockReset();
});

describe("lecture image extraction and display", () => {
  it("extracts referenced DOCX figures in document order and skips unreferenced media", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", '<w:document xmlns:w="w" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><a:blip r:embed="rIdFigure"/></w:body></w:document>');
    zip.file("word/_rels/document.xml.rels", '<Relationships><Relationship Id="rIdFigure" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/figure.png"/><Relationship Id="rIdUnused" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/thumbnail.png"/></Relationships>');
    zip.file("word/media/figure.png", new Uint8Array([1, 2, 3]));
    zip.file("word/media/thumbnail.png", new Uint8Array([4, 5, 6]));
    const archive = await zip.generateAsync({ type: "uint8array" });
    const archiveBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
    const file = new File([new Uint8Array(archiveBuffer)], "lecture.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => archiveBuffer });
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,compact");
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1600, height: 800, close: vi.fn() })));
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["image"], { type: "image/png" }) })));

    const visuals = await extractQuizVisuals(file, 3);
    expect(visuals).toHaveLength(1);
    expect(visuals[0]).toMatchObject({ kind: "docx", sourceIndex: 0, name: "lecture.docx — image 1", data: "data:image/jpeg;base64,compact" });
    expect(context.drawImage).toHaveBeenCalled();
  });

  it("keeps image proportions and provides descriptive alt text beside a question", () => {
    render(<QuizQuestionImage path="figures/lecture.png" kind="image" dataUrl="data:image/jpeg;base64,figure" name="Figure 2" />);
    const image = screen.getByRole("img", { name: "Lecture image: Figure 2" });
    expect(image).toHaveClass("object-contain");
    expect(image).toHaveClass("max-w-full");
  });

  it("shows a safe fallback when an image upload is no longer accessible", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "not found" } });
    render(<QuizQuestionImage path="missing/lecture.png" kind="image" name="Figure 2" />);
    expect(await screen.findByText(/image is currently unavailable/i)).toBeInTheDocument();
  });
});
