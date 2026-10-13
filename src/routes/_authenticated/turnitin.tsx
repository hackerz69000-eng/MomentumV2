import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  FileText,
  FileUp,
  Info,
  Link2,
  Search,
  SlidersHorizontal,
  FileSearch,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import mammoth from "mammoth";
import { analyzeSimilarity, filterSimilarityMatches, scoreFilteredMatches, getSimilarityHighlightSegments, type SimilarityAnalysis, type SimilaritySource } from "@/lib/similarity-report";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { btnGhost, btnPrimary, inputCls } from "@/components/set/ui";

export const Route = createFileRoute("/_authenticated/turnitin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Turnitin Similarity Pre-check — Momentum" },
      {
        name: "description",
        content:
          "Compare an essay against supplied reference texts using a transparent local similarity pre-check, then review the submission workflow.",
      },
    ],
  }),
  component: TurnitinSubmissionPage,
});

// Turnitin's exact available options and limits can vary by assignment and institution.
// These are the common file types that can produce Similarity Reports, not a guarantee
// that a specific instructor's assignment accepts every type.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".hwp", ".hwpx",
  ".pptx", ".ppsx", ".pps", ".html", ".htm", ".ps",
];

type SubmissionMethod = "file" | "text" | "cloud";
type WorkflowStep = "details" | "review" | "report" | "complete";
type AssignmentVersion = "standard" | "classic";

function isAcceptedFile(file: File) {
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function TurnitinSubmissionPage() {
  const [version, setVersion] = useState<AssignmentVersion>("standard");
  const [step, setStep] = useState<WorkflowStep>("details");
  const [method, setMethod] = useState<SubmissionMethod>("file");
  const [file, setFile] = useState<File | null>(null);
  const [essayText, setEssayText] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [paperTitle, setPaperTitle] = useState("");
  const [courseName, setCourseName] = useState("");
  const [assignmentName, setAssignmentName] = useState("");
  const [instructor, setInstructor] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [portalUrl, setPortalUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmedPreview, setConfirmedPreview] = useState(false);
  const [practiceComplete, setPracticeComplete] = useState(false);
  const [localObjectUrl, setLocalObjectUrl] = useState<string | null>(null);
  const [referenceSources, setReferenceSources] = useState<SimilaritySource[]>([]);
  const [referenceTitle, setReferenceTitle] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [includeQuotes, setIncludeQuotes] = useState(true);
  const [includeCitations, setIncludeCitations] = useState(true);
  const [includeBibliography, setIncludeBibliography] = useState(true);
  const [minimumMatchWords, setMinimumMatchWords] = useState(8);
  const [excludedSourceIds, setExcludedSourceIds] = useState<string[]>([]);
  const [publicSearchConsent, setPublicSearchConsent] = useState(false);
  const [publicSearchBusy, setPublicSearchBusy] = useState(false);
  const [publicSearchError, setPublicSearchError] = useState<string | null>(null);
  const [remoteAnalysis, setRemoteAnalysis] = useState<SimilarityAnalysis | null>(null);
  const [remoteSearchMeta, setRemoteSearchMeta] = useState<{
    providers?: { publicWeb: boolean; scholarlyMetadata: boolean; openAlex?: boolean; arxiv?: boolean; openAccessFullText?: boolean };
    providerWarnings?: string[];
    queryCount?: number;
    sourceCount?: number;
    coverageSummary?: { fullPages: number; searchSnippets: number; abstracts: number; openAccessFullTexts?: number };
    matchesTruncated?: boolean;
  } | null>(null);

  const words = useMemo(() => countWords(essayText), [essayText]);
  const textInputAvailable = version === "classic";
  const analysisText = method === "text" ? essayText : previewText ?? "";
  const localSimilarityAnalysis = useMemo(() => analyzeSimilarity(analysisText, referenceSources), [analysisText, referenceSources]);
  const similarityAnalysis = useMemo(() => {
    if (!remoteAnalysis) return localSimilarityAnalysis;
    const matches = [...localSimilarityAnalysis.matches, ...remoteAnalysis.matches];
    const matched = new Set<number>([
      ...localSimilarityAnalysis.matchedWordIndexes,
      ...(remoteAnalysis?.matchedWordIndexes ?? []),
    ]);
    for (const match of matches) for (const index of (match.matchedWordIndexes ?? Array.from({ length: match.endWord - match.startWord }, (_, i) => match.startWord + i))) matched.add(index);
    const sourceMap = new Map<string, (typeof localSimilarityAnalysis.sources)[number]>();
    for (const source of [...localSimilarityAnalysis.sources, ...remoteAnalysis.sources]) sourceMap.set(source.id, source);
    const sourcePriority = (kind: (typeof localSimilarityAnalysis.sources)[number]["kind"]) => kind === "internet" ? 0 : kind === "publication" ? 1 : kind === "student-paper" ? 2 : 3;
    const sources = [...sourceMap.values()].sort((a, b) => b.matchedWords - a.matchedWords || sourcePriority(a.kind) - sourcePriority(b.kind));
    return {
      wordCount: localSimilarityAnalysis.wordCount || remoteAnalysis.wordCount,
      matches: matches.sort((a, b) => a.startWord - b.startWord || b.matchedWords - a.matchedWords),
      sources,
      matchedWordIndexes: [...matched].sort((a, b) => a - b),
      percentage: (localSimilarityAnalysis.wordCount || remoteAnalysis.wordCount) ? Math.round((matched.size / (localSimilarityAnalysis.wordCount || remoteAnalysis.wordCount)) * 1000) / 10 : 0,
      coverageNote: "This combines local comparisons against your supplied sources with public-web pages/snippets and scholarly abstracts retrieved for this run. It is not a Turnitin score and cannot search private student-paper repositories.",
    };
  }, [localSimilarityAnalysis, remoteAnalysis]);
  const visibleMatches = useMemo(() => filterSimilarityMatches(similarityAnalysis.matches, {
    includeQuotes, includeCitations, includeBibliography, minimumMatchWords, excludedSourceIds,
  }), [similarityAnalysis.matches, includeQuotes, includeCitations, includeBibliography, minimumMatchWords, excludedSourceIds]);
  const filteredScore = useMemo(() => {
    // The default report uses the complete deduplicated index set, even if the server
    // caps detailed passage payloads for very repetitive/large essays. Filtered views
    // recalculate from the passages currently available and show a truncation notice.
    if (includeQuotes && includeCitations && includeBibliography && excludedSourceIds.length === 0 && minimumMatchWords <= 8) {
      const matchedWords = similarityAnalysis.matchedWordIndexes.length;
      return { matchedWords, percentage: similarityAnalysis.wordCount ? Math.round((matchedWords / similarityAnalysis.wordCount) * 1000) / 10 : 0, matchedWordIndexes: similarityAnalysis.matchedWordIndexes };
    }
    return scoreFilteredMatches(visibleMatches, similarityAnalysis.wordCount);
  }, [visibleMatches, similarityAnalysis.wordCount, similarityAnalysis.matchedWordIndexes, includeQuotes, includeCitations, includeBibliography, excludedSourceIds, minimumMatchWords]);
  const matchGroupStats = useMemo(() => {
    const groups = [
      { id: "not-cited-or-quoted", label: "Not Cited or Quoted" },
      { id: "missing-quotation", label: "Missing Quotations" },
      { id: "missing-citation", label: "Missing Citation" },
      { id: "cited-and-quoted", label: "Cited and Quoted" },
    ] as const;
    return groups.map((group) => {
      const groupMatches = visibleMatches.filter((match) => match.group === group.id);
      const indexes = new Set<number>();
      for (const match of groupMatches) for (const index of (match.matchedWordIndexes ?? Array.from({ length: match.endWord - match.startWord }, (_, i) => match.startWord + i))) indexes.add(index);
      return { ...group, matches: groupMatches.length, words: indexes.size };
    });
  }, [visibleMatches]);
  const visibleSourceStats = useMemo(() => {
    if (includeQuotes && includeCitations && includeBibliography && excludedSourceIds.length === 0 && minimumMatchWords <= 8) return similarityAnalysis.sources;
    return similarityAnalysis.sources.map((source) => {
      const sourceMatches = visibleMatches.filter((match) => match.sourceId === source.id);
      const wordIndexes = new Set<number>();
      for (const match of sourceMatches) for (const i of (match.matchedWordIndexes ?? Array.from({ length: match.endWord - match.startWord }, (_, index) => match.startWord + index))) wordIndexes.add(i);
      return { ...source, matchedWords: wordIndexes.size, percentage: similarityAnalysis.wordCount ? Math.round((wordIndexes.size / similarityAnalysis.wordCount) * 1000) / 10 : 0, matchCount: sourceMatches.length };
    });
  }, [similarityAnalysis.sources, similarityAnalysis.wordCount, visibleMatches, includeQuotes, includeCitations, includeBibliography, excludedSourceIds, minimumMatchWords]);
  const validPortalUrl = useMemo(() => {
    if (!portalUrl.trim()) return null;
    try {
      const parsed = new URL(portalUrl.trim());
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
    } catch {
      return null;
    }
  }, [portalUrl]);

  useEffect(() => {
    setRemoteAnalysis(null);
    setRemoteSearchMeta(null);
    setPublicSearchError(null);
    setPublicSearchConsent(false);
  }, [analysisText]);

  useEffect(() => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      setLocalObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const resetAfterEdit = () => {
    setStep("details");
    setError(null);
    setConfirmedPreview(false);
    setPracticeComplete(false);
  };

  const chooseFile = (nextFile: File | null) => {
    setError(null);
    resetAfterEdit();
    if (!nextFile) {
      setFile(null);
      setPreviewText(null);
      setPreviewError(null);
      return;
    }
    if (!isAcceptedFile(nextFile)) {
      setFile(null);
      setPreviewText(null);
      setPreviewError(null);
      setError("This file type is not in the common Turnitin Similarity Report list. Try DOC/DOCX, PDF, TXT, RTF, ODT, or another supported format.");
      return;
    }
    if (nextFile.size >= MAX_FILE_BYTES) {
      setFile(null);
      setPreviewText(null);
      setPreviewError(null);
      setError("This file must be smaller than the common 100 MB Turnitin limit. Your instructor's assignment settings may impose a lower limit.");
      return;
    }
    if (nextFile.size === 0) {
      setFile(null);
      setPreviewText(null);
      setPreviewError(null);
      setError("That file appears to be empty. Choose another file.");
      return;
    }
    setFile(nextFile);
    setPreviewText(null);
    setPreviewError(null);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.target.files?.[0] ?? null);
    event.target.value = "";
  };

  const canContinue = () => {
    if (!paperTitle.trim() || !courseName.trim() || !assignmentName.trim()) {
      setError("Enter the submission title, course/class, and assignment name before continuing.");
      return false;
    }
    if (method === "file" && !file) {
      setError("Choose one paper file to upload and review.");
      return false;
    }
    if (method === "text" && !essayText.trim()) {
      setError("Enter the submission text before continuing.");
      return false;
    }
    if (method === "cloud") {
      setError("Cloud-drive submission is not connected in Momentum. Select a file from your device, or use Text Input in Classic practice mode.");
      return false;
    }
    if (method === "text" && words < 20) {
      setError("This text contains fewer than 20 words. Turnitin requires at least 20 words for submissions intended to generate a Similarity Report.");
      return false;
    }
    if (file && file.size >= MAX_FILE_BYTES) {
      setError("This file must be smaller than the common 100 MB Turnitin limit.");
      return false;
    }
    if (portalUrl.trim() && !validPortalUrl) {
      setError("Enter a valid http:// or https:// course portal URL.");
      return false;
    }
    setError(null);
    return true;
  };

  const addPastedReference = () => {
    if (!referenceTitle.trim() || !referenceText.trim()) {
      setSourceError("Add a source title and paste the source text first.");
      return;
    }
    if (countWords(referenceText) < 8) {
      setSourceError("Add at least 8 words so Momentum can look for meaningful phrase matches.");
      return;
    }
    if (referenceText.length > 500000) {
      setSourceError("For responsive local analysis, each pasted source is limited to 500,000 characters. Add a relevant excerpt instead.");
      return;
    }
    const normalizedUrl = referenceUrl.trim();
    if (normalizedUrl) {
      try {
        const parsed = new URL(normalizedUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
      } catch {
        setSourceError("Enter a valid http:// or https:// source URL, or leave it blank.");
        return;
      }
    }
    setReferenceSources((current) => [...current, { id: `source-${Date.now()}-${current.length}`, title: referenceTitle.trim(), text: referenceText, kind: "provided-source", ...(normalizedUrl ? { url: normalizedUrl } : {}) }]);
    setReferenceTitle("");
    setReferenceUrl("");
    setReferenceText("");
    setSourceError(null);
    setExcludedSourceIds([]);
  };

  const extractComparisonFile = async (sourceFile: File): Promise<string> => {
    const name = sourceFile.name.toLowerCase();
    if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) return sourceFile.text();
    if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ arrayBuffer: await sourceFile.arrayBuffer() });
      return result.value;
    }
    if (name.endsWith(".pdf")) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(await sourceFile.arrayBuffer()));
      const result = await extractText(pdf, { mergePages: false });
      return Array.isArray(result.text) ? result.text.join("\n") : result.text;
    }
    if (name.endsWith(".pptx")) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await sourceFile.arrayBuffer());
      const paths = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
      const slideText: string[] = [];
      for (const path of paths) {
        const xml = await zip.file(path)?.async("text");
        if (!xml) continue;
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        slideText.push(Array.from(doc.getElementsByTagName("a:t")).map((node) => node.textContent ?? "").join(" "));
      }
      return slideText.join("\n\n");
    }
    if (name.endsWith(".html") || name.endsWith(".htm")) {
      const doc = new DOMParser().parseFromString(await sourceFile.text(), "text/html");
      return doc.body.textContent ?? "";
    }
    if (name.endsWith(".rtf")) return (await sourceFile.text()).replace(/\\'[0-9a-f]{2}/gi, " ").replace(/\\[a-z]+-?\d* ?|[{}]/gi, " ").replace(/\s+/g, " ");
    if (name.endsWith(".odt")) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(await sourceFile.arrayBuffer());
      const xml = await zip.file("content.xml")?.async("text");
      if (!xml) return "";
      return new DOMParser().parseFromString(xml, "application/xml").documentElement.textContent ?? "";
    }
    throw new Error("Use a TXT, Markdown, DOCX, PDF, HTML, RTF, or ODT source file.");
  };

  const addReferenceFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    setSourceError(null);
    for (const sourceFile of selected) {
      try {
        if (sourceFile.size > 20 * 1024 * 1024) throw new Error(`${sourceFile.name} is larger than the 20 MB local comparison limit.`);
        const extracted = await extractComparisonFile(sourceFile);
        if (countWords(extracted) < 8) throw new Error(`Couldn't extract enough selectable text from ${sourceFile.name}. Scanned PDFs may need OCR or pasted text.`);
        if (extracted.length > 500000) throw new Error(`${sourceFile.name} contains too much text for responsive local analysis. Add a relevant excerpt instead.`);
        setReferenceSources((current) => [...current, { id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: sourceFile.name, text: extracted, kind: "provided-source" }]);
      } catch (err) {
        setSourceError(err instanceof Error ? err.message : `Couldn't read ${sourceFile.name}.`);
      }
    }
    setExcludedSourceIds([]);
  };

  const searchPublicSources = async () => {
    if (!publicSearchConsent) {
      setPublicSearchError("Confirm the privacy notice before searching public sources.");
      return;
    }
    if (!analysisText.trim() || countWords(analysisText) < 20) {
      setPublicSearchError("Provide at least 20 words of readable essay text before searching.");
      return;
    }
    setPublicSearchBusy(true);
    setPublicSearchError(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) throw new Error("Your session could not be verified. Sign in again, then retry the source search.");
      const response = await fetch("/api/similarity-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ essayText: analysisText, consent: true }),
      });
      const payload = await response.json() as {
        error?: string;
        analysis?: SimilarityAnalysis & { matchesTruncated?: boolean };
        providers?: { publicWeb: boolean; scholarlyMetadata: boolean; openAlex?: boolean; arxiv?: boolean; openAccessFullText?: boolean };
        providerWarnings?: string[];
        queryCount?: number;
        sourceCount?: number;
        coverageSummary?: { fullPages: number; searchSnippets: number; abstracts: number; openAccessFullTexts?: number };
      };
      if (!response.ok) throw new Error(payload.error || "Public source search failed.");
      setRemoteSearchMeta({
        ...(payload.providers ? { providers: payload.providers } : {}),
        ...(payload.providerWarnings ? { providerWarnings: payload.providerWarnings } : {}),
        ...(payload.queryCount !== undefined ? { queryCount: payload.queryCount } : {}),
        ...(payload.sourceCount !== undefined ? { sourceCount: payload.sourceCount } : {}),
        ...(payload.coverageSummary ? { coverageSummary: payload.coverageSummary } : {}),
        ...(payload.analysis?.matchesTruncated !== undefined ? { matchesTruncated: payload.analysis.matchesTruncated } : {}),
      });
      if (!payload.analysis) throw new Error(payload.error || "No searchable source text was retrieved. Add your own sources or configure public-web search on the deployment.");
      setRemoteAnalysis(payload.analysis);
      setExcludedSourceIds([]);
    } catch (err) {
      setPublicSearchError(err instanceof Error ? err.message : "Public source search failed. Try again or add source documents manually.");
    } finally {
      setPublicSearchBusy(false);
    }
  };

  const openSimilarityReport = () => {
    if (!confirmedPreview) {
      setError("Confirm that you reviewed the document before running the similarity pre-check.");
      return;
    }
    if (!analysisText.trim()) {
      setError("Momentum couldn't extract readable essay text from this file. Use pasted text or upload a selectable-text PDF, DOCX, or TXT file to run the pre-check.");
      return;
    }
    if (analysisText.length > 500000) {
      setError("The local similarity pre-check supports up to 500,000 characters per essay to keep your browser responsive. Use a text extract or shorter draft.");
      return;
    }
    setError(null);
    setStep("report");
  };

  const toggleExcludedSource = (sourceId: string) => {
    setExcludedSourceIds((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]);
  };

  const uploadAndReview = async () => {
    if (!canContinue()) return;
    setPreviewText(null);
    setPreviewError(null);
    if (method === "text") {
      setPreviewText(essayText);
    } else if (file) {
      try {
        const extracted = await extractComparisonFile(file);
        if (extracted.trim()) setPreviewText(extracted);
        else setPreviewError("No selectable text could be extracted. This may be a scanned or unsupported document; use a text-based file or paste the text to run the similarity pre-check.");
      } catch (err) {
        setPreviewError(err instanceof Error ? `${err.message} Momentum can still show the original file, but the similarity pre-check needs extracted text.` : "Momentum couldn't extract readable text from this document. Use a text-based file or paste the text to run the similarity pre-check.");
      }
    }
    setConfirmedPreview(false);
    setStep("review");
    setError(null);
  };

  const finishPractice = () => {
    if (!confirmedPreview) {
      setError("Confirm that you reviewed the document preview before completing the practice flow.");
      return;
    }
    setError(null);
    setPracticeComplete(true);
    setStep("complete");
  };

  const downloadText = () => {
    const blob = new Blob([essayText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeTitle = paperTitle.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "essay";
    anchor.href = url;
    anchor.download = `${safeTitle}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const startOver = () => {
    setStep("details");
    setMethod("file");
    setVersion("standard");
    setFile(null);
    setEssayText("");
    setPreviewText(null);
    setPreviewError(null);
    setPaperTitle("");
    setCourseName("");
    setAssignmentName("");
    setInstructor("");
    setDueDate("");
    setReferenceSources([]);
    setExcludedSourceIds([]);
    setSourceError(null);
    setReferenceTitle("");
    setReferenceUrl("");
    setReferenceText("");
    setConfirmedPreview(false);
    setPracticeComplete(false);
    setRemoteAnalysis(null);
    setRemoteSearchMeta(null);
    setPublicSearchError(null);
    setPublicSearchConsent(false);
    setError(null);
  };

  return (
    <main className="flex-1 min-w-0">
      <PageHeader
        title="Turnitin Submission & Similarity Pre-check"
        sub="Review your essay, compare it against supplied sources, and understand what an official Turnitin report can and cannot tell you."
      />
      <div className="p-5 md:p-8 max-w-6xl space-y-6">
        <div className="rounded-2xl border border-cool/30 bg-cool/10 p-4 md:p-5 flex items-start gap-3">
          <Info className="size-5 text-cool2 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">Practice mode — not connected to Turnitin</p>
              <span className="rounded-full border border-cool/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">Simulation</span>
            </div>
            <p className="text-sm text-soft leading-relaxed">
              Momentum can compare your essay with supplied materials and, if you explicitly opt in, search accessible public-web pages and scholarly abstracts. It cannot access Turnitin's private databases, generate an official Turnitin Similarity Report, or issue a digital receipt. Local-only analysis stays in your browser; public-source search sends the essay to your Momentum server for this request and sends short excerpts to configured search services. The search feature does not save the essay.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line/70 bg-panel p-4 md:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="eyebrow text-soft">Student submission workflow</p>
              <h2 className="font-display text-xl mt-1">{step === "details" ? "1. Submit your paper" : step === "review" ? "2. Review your submission" : step === "report" ? "3. Similarity pre-check" : "4. Practice complete"}</h2>
            </div>
            <span className="text-xs text-soft">Practice only · No official submission</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Submission steps">
            <StepPill active={step === "details"} complete={step === "review" || step === "report" || step === "complete"} number="1" label="Upload" />
            <StepPill active={step === "review"} complete={step === "report" || step === "complete"} number="2" label="Review" />
            <StepPill active={step === "report"} complete={step === "complete"} number="3" label="Similarity" />
            <StepPill active={step === "complete"} complete={false} number="4" label="Confirm" />
          </div>
        </div>

        {step === "details" && (
          <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)] gap-6 items-start">
            <section className="rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-cool/15 grid place-items-center"><ClipboardCheck className="size-5 text-cool2" /></div>
                <div>
                  <h2 className="font-display text-xl">Assignment details</h2>
                  <p className="text-sm text-soft">Use the title and class details shown on your real assignment page.</p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block text-sm sm:col-span-2"><span className="eyebrow text-soft">Submission title <Required /></span><input value={paperTitle} onChange={(e) => { setPaperTitle(e.target.value); resetAfterEdit(); }} className={`${inputCls} w-full mt-1.5`} placeholder="Enter submission title" maxLength={180} /></label>
                <label className="block text-sm"><span className="eyebrow text-soft">Class / course <Required /></span><input value={courseName} onChange={(e) => { setCourseName(e.target.value); resetAfterEdit(); }} className={`${inputCls} w-full mt-1.5`} placeholder="e.g. POLS 1000A" maxLength={120} /></label>
                <label className="block text-sm"><span className="eyebrow text-soft">Assignment <Required /></span><input value={assignmentName} onChange={(e) => { setAssignmentName(e.target.value); resetAfterEdit(); }} className={`${inputCls} w-full mt-1.5`} placeholder="e.g. Issue Reaction Paper" maxLength={180} /></label>
                <label className="block text-sm"><span className="eyebrow text-soft">Instructor (optional)</span><input value={instructor} onChange={(e) => { setInstructor(e.target.value); resetAfterEdit(); }} className={`${inputCls} w-full mt-1.5`} placeholder="Instructor's name" maxLength={120} /></label>
                <label className="block text-sm"><span className="eyebrow text-soft">Due date (optional)</span><input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); resetAfterEdit(); }} className={`${inputCls} w-full mt-1.5`} /></label>
              </div>

              <div className="space-y-3 border-t border-line/70 pt-5">
                <div>
                  <h3 className="font-semibold">Assignment experience</h3>
                  <p className="text-sm text-soft mt-1">Turnitin has different assignment interfaces. Your instructor's setup determines which options are available.</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <button type="button" onClick={() => { setVersion("standard"); if (method === "text") setMethod("file"); resetAfterEdit(); }} className={`text-left rounded-xl border p-3 ${version === "standard" ? "border-cool2 bg-cool/10" : "border-line hover:border-cool/40"}`}>
                    <span className="font-semibold block">Standard assignment</span><span className="text-xs text-soft mt-1 block">Upload a single document, review it, then submit.</span>
                  </button>
                  <button type="button" onClick={() => { setVersion("classic"); resetAfterEdit(); }} className={`text-left rounded-xl border p-3 ${version === "classic" ? "border-cool2 bg-cool/10" : "border-line hover:border-cool/40"}`}>
                    <span className="font-semibold block">Standard (Classic)</span><span className="text-xs text-soft mt-1 block">Includes the classic Text Input option in addition to file upload.</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3 border-t border-line/70 pt-5">
                <div><h3 className="font-semibold">Choose a submission method</h3><p className="text-sm text-soft mt-1">A Turnitin assignment normally accepts one document per submission.</p></div>
                <div className="grid sm:grid-cols-3 gap-2">
                  <MethodButton active={method === "file"} onClick={() => { setMethod("file"); resetAfterEdit(); }} icon={<FileUp className="size-4" />} title="Upload submission" detail="From this device" />
                  <MethodButton active={method === "text"} disabled={!textInputAvailable} onClick={() => { setMethod("text"); resetAfterEdit(); }} icon={<FileText className="size-4" />} title="Text Input" detail={textInputAvailable ? "Paste your paper" : "Classic interface only"} />
                  <MethodButton active={method === "cloud"} onClick={() => { setMethod("cloud"); resetAfterEdit(); }} icon={<Cloud className="size-4" />} title="Cloud submission" detail="Not connected in practice mode" />
                </div>
              </div>

              {method === "file" && <div className="space-y-3">
                <label onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0] ?? null); }} className={`block cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-cool2 bg-cool/10" : "border-line hover:border-cool/50"}`}>
                  <UploadCloud className="size-8 text-cool2 mx-auto mb-3" /><span className="font-semibold block">Drag and drop your paper, or browse</span><span className="text-sm text-soft block mt-1">DOC, DOCX, PDF, TXT, RTF, ODT, PPTX, and other supported formats · Up to 100 MB</span>
                  <input type="file" accept={ACCEPTED_EXTENSIONS.join(",")} onChange={onFileChange} className="sr-only" />
                </label>
                {file && <div className="rounded-xl border border-line/70 bg-foreground/[0.025] p-3 flex items-center gap-3"><div className="size-10 rounded-lg bg-cool/15 grid place-items-center shrink-0"><FileText className="size-5 text-cool2" /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold break-words">{file.name}</p><p className="text-xs text-soft">{formatBytes(file.size)} · Selected in this browser only</p></div><button type="button" className="p-2 rounded-lg text-soft hover:text-foreground" onClick={() => chooseFile(null)} aria-label="Remove selected file"><X className="size-4" /></button></div>}
                <p className="text-xs text-soft">Common Similarity Report requirements: smaller than 100 MB, fewer than 800 pages, and at least 20 words. Your instructor may configure different allowed file types. Scanned/image-only PDFs may not be accepted for similarity checking.</p>
              </div>}

              {method === "text" && <div className="space-y-2"><label className="block text-sm"><span className="eyebrow text-soft">Submission text</span><textarea value={essayText} onChange={(e) => { setEssayText(e.target.value); resetAfterEdit(); }} className={`${inputCls} w-full min-h-72 resize-y leading-relaxed mt-1.5`} placeholder="Paste your paper text here…" maxLength={500000} /></label><div className="flex flex-wrap items-center justify-between gap-2 text-xs text-soft"><span>{words.toLocaleString()} words · {essayText.length.toLocaleString()} characters</span><button type="button" onClick={downloadText} disabled={!essayText.trim()} className={btnGhost}>Download as .txt</button></div><p className="text-xs text-soft">Text Input is shown for the Classic practice workflow only. The real assignment must have this method available.</p></div>}

              {method === "cloud" && <div className="rounded-xl border border-line bg-foreground/[0.025] p-4 space-y-2"><div className="flex items-center gap-2 font-semibold"><Cloud className="size-5 text-cool2" />Cloud submission</div><p className="text-sm text-soft">Real Turnitin integrations may offer cloud storage choices depending on the platform. Momentum is not connected to Google Drive, OneDrive, or your institution's Turnitin, so this practice option cannot browse or upload cloud files.</p><button type="button" onClick={() => { setMethod("file"); setError(null); }} className={btnGhost}>Choose a file from this device instead</button></div>}

              {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2 text-sm"><AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />{error}</div>}
              <button type="button" onClick={uploadAndReview} className={btnPrimary} disabled={method === "cloud"}>{method === "text" ? "Upload and Review" : "Upload and Review"} <ArrowRight className="size-4" /></button>
            </section>

            <section className="lg:col-span-2 rounded-2xl bg-panel border border-line/70 p-5 md:p-6 space-y-4">
              <div className="flex items-start gap-3"><div className="size-10 rounded-xl bg-cool/15 grid place-items-center"><FileSearch className="size-5 text-cool2" /></div><div><h2 className="font-display text-xl">Sources for the similarity pre-check</h2><p className="text-sm text-soft mt-1">Optional. Add course readings or source documents to compare locally. You can also opt into public source discovery from the report screen.</p></div></div>
              <div className="rounded-xl border border-cool/30 bg-cool/10 p-3 text-sm"><strong>Important:</strong> Turnitin checks large internet, publication, and student-paper databases. Momentum can only compare against the sources you add here; it cannot access Turnitin's private databases or return a real Turnitin score.</div>
              <label className="block text-sm"><span className="eyebrow text-soft">Add source documents</span><input type="file" multiple accept=".txt,.md,.markdown,.docx,.pdf,.pptx,.html,.htm,.rtf,.odt" onChange={addReferenceFiles} className="block w-full mt-1.5 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-cool/15 file:px-3 file:py-2 file:font-semibold" /><span className="text-xs text-soft block mt-1">TXT, Markdown, DOCX, selectable-text PDF, PPTX, HTML, RTF, ODT · 20 MB per reference file</span></label>
              <div className="grid md:grid-cols-2 gap-3"><label className="block text-sm"><span className="eyebrow text-soft">Source title</span><input value={referenceTitle} onChange={(e) => setReferenceTitle(e.target.value)} className={`${inputCls} w-full mt-1.5`} placeholder="e.g. Week 4 lecture notes" maxLength={180} /></label><label className="block text-sm"><span className="eyebrow text-soft">Source URL (optional)</span><input value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} className={`${inputCls} w-full mt-1.5`} placeholder="https://example.com/article" inputMode="url" /><span className="text-xs text-soft block mt-1">The URL is a citation/reference only for manually pasted text; public-source discovery can retrieve accessible pages after you opt in.</span></label><label className="block text-sm md:col-span-2"><span className="eyebrow text-soft">Paste source text</span><textarea value={referenceText} onChange={(e) => setReferenceText(e.target.value)} className={`${inputCls} w-full mt-1.5 min-h-24`} placeholder="Paste the source passage here…" /></label></div>
              <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={addPastedReference} className={btnGhost}><Plus className="size-4" /> Add pasted source</button><span className="text-xs text-soft">{referenceSources.length} source{referenceSources.length === 1 ? "" : "s"} added</span></div>
              {sourceError && <p role="alert" className="text-sm text-destructive">{sourceError}</p>}
              {referenceSources.length > 0 && <ul className="space-y-2">{referenceSources.map((source) => <li key={source.id} className="flex items-center gap-3 rounded-lg border border-line/70 p-3"><FileText className="size-4 text-cool2 shrink-0" /><span className="text-sm flex-1 min-w-0 break-words">{source.title}{source.url && <a href={source.url} target="_blank" rel="noopener noreferrer" className="block text-xs text-cool2 underline">Open source URL</a>}<span className="block text-xs text-soft">{countWords(source.text).toLocaleString()} words</span></span><button type="button" onClick={() => setReferenceSources((current) => current.filter((item) => item.id !== source.id))} className="rounded-lg p-2 hover:bg-foreground/5" aria-label={`Remove ${source.title}`}><Trash2 className="size-4" /></button></li>)}</ul>}
            </section>

            <aside className="space-y-4">
              <section className="rounded-2xl bg-panel border border-line/70 p-5 space-y-4"><div className="flex items-center gap-3"><div className="size-9 rounded-xl bg-cool/15 grid place-items-center"><ClipboardCheck className="size-4 text-cool2" /></div><h2 className="font-display text-lg">Before you upload</h2></div><ul className="space-y-3 text-sm"><ChecklistItem done={!!paperTitle.trim()} label="Submission title entered" /><ChecklistItem done={!!courseName.trim()} label="Class / course entered" /><ChecklistItem done={!!assignmentName.trim()} label="Assignment identified" /><ChecklistItem done={method === "file" ? !!file : method === "text" ? words >= 20 : false} label={method === "file" ? "One file selected" : method === "text" ? "Text has at least 20 words" : "Cloud account connected"} /></ul><p className="text-xs text-soft border-t border-line/70 pt-3">Turnitin's exact requirements depend on the assignment settings. The checklist cannot verify page count, file readability, deadlines, or your instructor's configuration.</p></section>
              <section className="rounded-2xl bg-panel border border-line/70 p-5 space-y-3"><div className="flex items-center gap-2"><Link2 className="size-4 text-cool2" /><h2 className="font-semibold">Official assignment link</h2></div><p className="text-sm text-soft">Optional: save the course assignment URL so you can open the real submission page after this practice.</p><label className="block text-sm"><span className="eyebrow text-soft">Course / Turnitin URL</span><input value={portalUrl} onChange={(e) => { setPortalUrl(e.target.value); resetAfterEdit(); }} className={`${inputCls} w-full mt-1.5`} placeholder="https://…" inputMode="url" /></label>{portalUrl.trim() && !validPortalUrl && <p className="text-xs text-destructive">Enter a full http:// or https:// URL.</p>}</section>
              <div className="rounded-xl bg-foreground/[0.025] border border-line/60 p-4 flex items-start gap-2.5 text-xs text-soft leading-relaxed"><Info className="size-4 shrink-0 text-cool2 mt-0.5" /><p>Official Turnitin submissions provide a completion message and digital receipt after successful submission. This practice page cannot produce either one.</p></div>
            </aside>
          </div>
        )}

        {step === "review" && <section className="rounded-2xl bg-panel border border-line/70 p-5 md:p-7 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow text-soft">Review before submitting</p><h2 className="font-display text-2xl mt-1">Check the document you selected</h2><p className="text-sm text-soft mt-2">This mirrors Turnitin's review step. Verify the title and content before proceeding.</p></div><span className="rounded-full border border-cool/40 bg-cool/10 px-3 py-1 text-xs font-semibold">Preview only</span></div>
          <div className="grid sm:grid-cols-2 gap-3"><InfoField label="Submission title" value={paperTitle} /><InfoField label="Class / course" value={courseName} /><InfoField label="Assignment" value={assignmentName} /><InfoField label="Instructor" value={instructor || "Not entered"} /><InfoField label="Due date" value={dueDate || "Not entered"} /><InfoField label="Submission method" value={method === "text" ? "Text Input (Classic)" : file ? `Upload · ${file.name}` : "Upload"} /></div>
          {file && <div className="rounded-xl border border-line/70 p-4 space-y-3"><div className="flex items-center gap-3"><div className="size-10 rounded-lg bg-cool/15 grid place-items-center"><FileText className="size-5 text-cool2" /></div><div className="flex-1 min-w-0"><p className="font-semibold break-words">{file.name}</p><p className="text-xs text-soft">{formatBytes(file.size)} · {file.type || "File type not reported"}</p></div></div>{localObjectUrl && <iframe title="PDF document preview" src={localObjectUrl} className="w-full h-[520px] rounded-lg border border-line" />}{previewText !== null && <div className="rounded-lg bg-foreground/[0.025] border border-line/60 p-4 max-h-[520px] overflow-auto"><p className="eyebrow text-soft mb-2">Extracted text preview</p><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{previewText.slice(0, 60000)}{previewText.length > 60000 ? "\n\n[Preview shortened]" : ""}</pre></div>}{previewError && <p className="text-sm text-soft flex gap-2"><Info className="size-4 shrink-0 mt-0.5 text-cool2" />{previewError}</p>}{previewText !== null && countWords(previewText) < 20 && <p className="text-sm text-destructive flex gap-2"><AlertCircle className="size-4 shrink-0 mt-0.5" />This preview contains fewer than 20 words. A submission this short may not generate a Turnitin Similarity Report.</p>}</div>}
          {method === "text" && <div className="rounded-xl border border-line/70 p-4 space-y-2"><div className="flex items-center justify-between gap-2"><p className="font-semibold">Text preview</p><span className="text-xs text-soft">{words.toLocaleString()} words</span></div><div className="max-h-[520px] overflow-auto rounded-lg bg-foreground/[0.025] p-4"><pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{essayText.slice(0, 60000)}{essayText.length > 60000 ? "\n\n[Preview shortened]" : ""}</pre></div></div>}
          <div className="rounded-xl border border-cool/30 bg-cool/10 p-4 flex items-start gap-3"><Info className="size-5 text-cool2 shrink-0 mt-0.5" /><div className="text-sm space-y-1"><p className="font-semibold">Check the original file, too</p><p className="text-soft">This preview is generated by Momentum and may not match Turnitin's document conversion exactly. For PDFs, confirm text is selectable; scanned image-only PDFs may not generate a Similarity Report. Turnitin also applies your instructor's settings.</p></div></div>
          <label className="flex items-start gap-3 text-sm cursor-pointer rounded-xl border border-line/70 p-4"><input type="checkbox" checked={confirmedPreview} onChange={(e) => { setConfirmedPreview(e.target.checked); setError(null); }} className="mt-1 accent-[var(--color-cool2)]" /><span>I reviewed the submission title and the document or text preview, and this is the version I intend to use.</span></label>
          {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2 text-sm"><AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />{error}</div>}
          <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={() => { setStep("details"); setError(null); }} className={btnGhost}><ArrowLeft className="size-4" /> Back and change file</button><button type="button" onClick={openSimilarityReport} className={btnPrimary}>Run similarity pre-check <Search className="size-4" /></button></div>
        </section>}

        {step === "report" && <section className="rounded-2xl bg-panel border border-line/70 p-5 md:p-7 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow text-soft">Similarity report · {remoteAnalysis ? "local + public-source pre-check" : "local pre-check"}</p><h2 className="font-display text-2xl mt-1">Matched passages and sources</h2><p className="text-sm text-soft mt-2">The report combines local source comparisons with any public pages, search snippets, or scholarly abstracts retrieved after consent. It is not a Turnitin report.</p></div><span className="rounded-full border border-cool/40 bg-cool/10 px-3 py-1 text-xs font-semibold">Local analysis only</span></div>
          <section className="rounded-xl border border-cool/30 bg-cool/5 p-4 space-y-3">
            <div className="flex items-start gap-3"><Search className="size-5 text-cool2 shrink-0 mt-0.5" /><div><h3 className="font-semibold">Search accessible public sources</h3><p className="text-sm text-soft mt-1">This expands the comparison beyond files you provide. Momentum searches selected short essay excerpts on the public web when configured and checks scholarly abstracts available through Crossref. It does not search Turnitin's student-paper repository.</p></div></div>
            <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" checked={publicSearchConsent} onChange={(event) => { setPublicSearchConsent(event.target.checked); setPublicSearchError(null); }} className="mt-1 accent-[var(--color-cool2)]" /><span>I consent to sending my essay to this Momentum server for one-time matching and sending up to four short excerpts as queries to public search services. The feature does not intentionally save the essay or return full source pages to the browser. I understand search providers process the queries under their own terms.</span></label>
            <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={searchPublicSources} disabled={!publicSearchConsent || publicSearchBusy || !analysisText.trim()} className={btnPrimary}>{publicSearchBusy ? <><span className="animate-spin size-4 rounded-full border-2 border-current border-t-transparent" /> Searching sources…</> : <><Search className="size-4" /> Search public and scholarly sources</>}</button>{remoteSearchMeta && <span className="text-xs text-soft">{remoteSearchMeta.sourceCount ?? 0} source texts retrieved · {remoteSearchMeta.queryCount ?? 0} queries</span>}</div>
            {publicSearchError && <p role="alert" className="text-sm text-destructive">{publicSearchError}</p>}
            {remoteSearchMeta?.providers && <p className="text-xs text-soft">Providers: public web {remoteSearchMeta.providers.publicWeb ? "configured" : "not configured"}; Crossref results {remoteSearchMeta.providers.scholarlyMetadata ? "found" : "none"}; OpenAlex results {remoteSearchMeta.providers.openAlex ? "found" : "none"}; arXiv results {remoteSearchMeta.providers.arxiv ? "found" : "none"}; open-access full text {remoteSearchMeta.providers.openAccessFullText ? "found" : "none"}.</p>}{remoteSearchMeta?.coverageSummary && <p className="text-xs text-soft">Retrieved for comparison: {remoteSearchMeta.coverageSummary.fullPages} readable web pages, {remoteSearchMeta.coverageSummary.searchSnippets} search snippets, and {remoteSearchMeta.coverageSummary.abstracts} scholarly abstracts ({remoteSearchMeta.coverageSummary.openAccessFullTexts ?? 0} open-access full texts).</p>}{remoteSearchMeta?.matchesTruncated && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">This essay produced more than 500 match passages. The overall pre-check rate uses all matched word positions, but filtered passage details are capped and filtered rates may be lower than the complete result.</p>}
            {remoteSearchMeta?.providerWarnings?.map((warning) => <p key={warning} className="text-xs text-soft">{warning}</p>)}
          </section>
          <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-4 text-sm space-y-1"><p><strong>Coverage limitation:</strong> {similarityAnalysis.coverageNote} A 0% result means no qualifying matches were found in the retrieved source text, not that Turnitin would return 0%.</p><p>A similarity match is not a plagiarism verdict. Review the source and context; a quotation may be properly cited, and this checker may miss matches that are paraphrased, in inaccessible sources, or in private student-paper repositories.</p></div>
          {referenceSources.length === 0 && !(remoteSearchMeta?.sourceCount ?? 0) ? <div className="rounded-xl border border-line/70 p-5 text-center space-y-2"><Search className="size-8 mx-auto text-soft" /><h3 className="font-semibold">No comparison sources added yet</h3><p className="text-sm text-soft">Add course notes or assigned readings, or consent to search accessible public and scholarly sources. A score cannot be calculated without source text.</p><button type="button" onClick={() => setStep("details")} className={btnGhost}>Add comparison sources</button></div> : <>
            <div className="grid sm:grid-cols-3 gap-3"><div className="rounded-xl border border-line/70 p-4"><p className="eyebrow text-soft">Matched words</p><p className="font-display text-3xl mt-1">{filteredScore.matchedWords.toLocaleString()}</p><p className="text-xs text-soft mt-1">Unique essay words in visible matches</p></div><div className="rounded-xl border border-line/70 p-4"><p className="eyebrow text-soft">Pre-check match rate</p><p className="font-display text-3xl mt-1">{filteredScore.percentage}%</p><p className="text-xs text-soft mt-1">Of {similarityAnalysis.wordCount.toLocaleString()} extracted words</p></div><div className="rounded-xl border border-line/70 p-4"><p className="eyebrow text-soft">Matched passages</p><p className="font-display text-3xl mt-1">{visibleMatches.length}</p><p className="text-xs text-soft mt-1">After current filters</p></div></div>
            <section className="space-y-2"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Match groups</h3><span className="text-xs text-soft">Heuristic classification · review each match</span></div><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">{matchGroupStats.map((group) => <div key={group.id} className="rounded-xl border border-line/70 p-3"><p className="text-sm font-semibold">{group.label}</p><p className="font-display text-2xl mt-1">{group.words.toLocaleString()} <span className="text-xs font-sans text-soft">words</span></p><p className="text-xs text-soft">{group.matches} match{group.matches === 1 ? "" : "es"}</p></div>)}</div></section>
            <details className="rounded-xl border border-line/70 p-4"><summary className="flex cursor-pointer items-center gap-2 font-semibold"><SlidersHorizontal className="size-4" /> Filters and exclusions</summary><div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={includeQuotes} onChange={(e) => setIncludeQuotes(e.target.checked)} /> Include quoted matches</label><label className="flex items-center gap-2"><input type="checkbox" checked={includeCitations} onChange={(e) => setIncludeCitations(e.target.checked)} /> Include matches near citations</label><label className="flex items-center gap-2"><input type="checkbox" checked={includeBibliography} onChange={(e) => setIncludeBibliography(e.target.checked)} /> Include bibliography matches</label><label className="block">Minimum matched words<select value={minimumMatchWords} onChange={(e) => setMinimumMatchWords(Number(e.target.value))} className={`${inputCls} w-full mt-1`}><option value={8}>8 words (default)</option><option value={12}>12 words</option><option value={20}>20 words</option><option value={50}>50 words</option></select></label></div><div className="mt-4 space-y-2"><p className="text-xs text-soft">Exclude a source from the visible report:</p>{similarityAnalysis.sources.map((source) => <label key={source.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={excludedSourceIds.includes(source.id)} onChange={() => toggleExcludedSource(source.id)} /> Exclude {source.title}</label>)}</div></details>
            <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.75fr)] gap-5 items-start"><div className="rounded-xl border border-line/70 p-4 space-y-3"><h3 className="font-semibold">Document view</h3><p className="text-xs text-soft">Highlights use local match-group colors: rose = not cited or quoted, orange = possible missing quotation marks, blue = possible missing citation, green = cited and quoted. Classification is heuristic and may be wrong.</p><div className="max-h-[720px] overflow-auto rounded-lg bg-foreground/[0.025] border border-line/60 p-4 text-sm leading-7 whitespace-pre-wrap break-words">{getSimilarityHighlightSegments(analysisText, visibleMatches).map((segment, index) => segment.matched ? <mark key={index} className={`rounded-sm px-0.5 text-foreground ${segment.group === "not-cited-or-quoted" ? "bg-rose-300/60 dark:bg-rose-300/25" : segment.group === "missing-quotation" ? "bg-orange-300/60 dark:bg-orange-300/25" : segment.group === "missing-citation" ? "bg-sky-300/60 dark:bg-sky-300/25" : "bg-emerald-300/60 dark:bg-emerald-300/25"}`}>{segment.text}</mark> : <span key={index}>{segment.text}</span>)}</div><h3 className="font-semibold pt-2">Matched passages</h3>{visibleMatches.length === 0 ? <p className="text-sm text-soft">No matches meet the current phrase-length and filter settings.</p> : <div className="space-y-3">{visibleMatches.map((match, index) => <article key={match.id} className="rounded-lg border border-line/70 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-cool2">Match {index + 1} · {match.matchedWords} words</span><span className="text-xs text-soft">{match.group.replaceAll("-", " ")}</span></div><p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-soft">Matched text in your essay</p><p className="mt-1 text-sm leading-relaxed">…{match.snippet}…</p>{match.sourceSnippet && <><p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-soft">Corresponding source excerpt</p><p className="mt-1 text-sm leading-relaxed rounded-md bg-foreground/[0.035] p-2">…{match.sourceSnippet}…</p></>}<p className="text-xs text-soft mt-2">Source: {match.sourceTitle}</p>{visibleMatches.some((other) => other.id !== match.id && other.startWord < match.endWord && other.endWord > match.startWord) && <p className="text-xs text-soft mt-1">Also matched by: {[...new Set(visibleMatches.filter((other) => other.id !== match.id && other.startWord < match.endWord && other.endWord > match.startWord).map((other) => other.sourceTitle))].join(", ")}</p>}</article>)}</div>}</div>
              <aside className="rounded-xl border border-line/70 p-4 space-y-3"><h3 className="font-semibold">Sources, ranked by matched words</h3>{similarityAnalysis.sources.length === 0 ? <p className="text-sm text-soft">No matches found in the provided sources.</p> : visibleSourceStats.map((source, index) => <div key={source.id} className={`rounded-lg border p-3 ${excludedSourceIds.includes(source.id) ? "border-line opacity-50" : "border-line/70"}`}><div className="flex items-start gap-2"><span className="size-6 rounded-md bg-cool/15 text-cool2 grid place-items-center text-xs font-bold shrink-0">{index + 1}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold break-words">{source.title}</p>{source.url && <a href={source.url} target="_blank" rel="noopener noreferrer" className="block text-xs text-cool2 underline mt-1">Open source</a>}<p className="text-xs text-soft mt-1">{source.kind === "internet" ? "Public web" : source.kind === "publication" ? "Scholarly publication metadata" : source.kind === "student-paper" ? "Student paper" : "Provided source"}{source.coverage === "search-snippet" ? " · search snippet" : source.coverage === "abstract" ? " · abstract only" : source.coverage === "full-page" ? " · page text" : ""}</p><p className="text-xs text-soft mt-1">{source.matchedWords} matched words · {source.percentage}% of essay · {source.matchCount} passage{source.matchCount === 1 ? "" : "s"}</p></div></div><button type="button" onClick={() => toggleExcludedSource(source.id)} className="text-xs text-cool2 mt-2 underline">{excludedSourceIds.includes(source.id) ? "Restore source" : "Exclude source"}</button></div>)}<p className="text-xs text-soft">Overlapping phrases may appear under more than one source. The overall rate counts each matched essay word only once. Matches against a search snippet or abstract are limited to that excerpt and do not represent a full-document comparison.</p></aside></div>
          </>}
          <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={() => setStep("review")} className={btnGhost}><ArrowLeft className="size-4" /> Back to document review</button><button type="button" onClick={finishPractice} className={btnPrimary}>Continue to practice confirmation <ArrowRight className="size-4" /></button></div>
        </section>}

        {step === "complete" && <section role="status" className="rounded-2xl border border-cool/30 bg-panel p-5 md:p-8 space-y-5"><div className="flex items-start gap-3"><div className="size-12 rounded-full bg-cool/15 grid place-items-center shrink-0"><CheckCircle2 className="size-6 text-cool2" /></div><div><p className="eyebrow text-cool2">Practice flow completed</p><h2 className="font-display text-2xl mt-1">Your pre-submission review is complete</h2><p className="text-sm text-soft mt-2">You reviewed your document and, if comparison sources were added, ran a local similarity pre-check.</p></div></div><div className="rounded-xl border-2 border-dashed border-destructive/50 bg-destructive/5 p-4"><p className="font-bold text-destructive">NOT SUBMITTED TO TURNITIN</p><p className="text-sm mt-1">This is not an official submission confirmation. There is no Turnitin submission ID, digital receipt, or official Similarity Report from this workflow.</p></div><div className="grid sm:grid-cols-2 gap-3"><InfoField label="Submission title" value={paperTitle} /><InfoField label="Course / assignment" value={`${courseName} · ${assignmentName}`} /><InfoField label="Document" value={method === "text" ? `${words.toLocaleString()} words pasted as text` : file?.name ?? "No file"} /><InfoField label="Practice status" value={practiceComplete ? "Review completed locally" : "Not completed"} /></div><div className="flex flex-wrap gap-3"><button type="button" onClick={startOver} className={btnGhost}>Start another practice submission</button>{validPortalUrl ? <a href={validPortalUrl} target="_blank" rel="noopener noreferrer" className={btnPrimary}>Open official assignment <ArrowUpRight className="size-4" /></a> : <p className="text-sm text-soft self-center">Open your school's LMS and select the correct Turnitin assignment to submit for real.</p>}</div><p className="text-xs text-soft">Nothing was sent to Turnitin. The local pre-check is not a Turnitin Similarity Report. To receive the actual report and submission receipt, submit through your institution's real Turnitin/LMS page.</p></section>}
      </div>
    </main>
  );
}

function Required() { return <span className="text-destructive">*</span>; }

function StepPill({ active, complete, number, label }: { active: boolean; complete: boolean; number: string; label: string }) {
  return <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${active ? "border-cool2 bg-cool/10 text-foreground" : complete ? "border-mint/30 bg-mint/5 text-foreground" : "border-line text-soft"}`}><span className="size-6 rounded-full grid place-items-center border border-current text-xs font-bold">{complete ? <Check className="size-3.5" /> : number}</span><span className="font-semibold">{label}</span></div>;
}

function MethodButton({ active, disabled, onClick, icon, title, detail }: { active: boolean; disabled?: boolean; onClick: () => void; icon: ReactNode; title: string; detail: string }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`text-left rounded-xl border p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${active ? "border-cool2 bg-cool/10" : "border-line hover:border-cool/40"}`}><span className="flex items-center gap-2 font-semibold">{icon}{title}</span><span className="text-xs text-soft mt-1 block">{detail}</span></button>;
}

function InfoField({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-line/70 p-3 min-w-0"><p className="eyebrow text-soft">{label}</p><p className="text-sm font-medium mt-1 break-words">{value}</p></div>;
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return <li className="flex items-center gap-2.5"><span className={`size-5 rounded-full grid place-items-center shrink-0 ${done ? "bg-mint/15 text-mint" : "border border-line text-soft"}`}>{done ? <Check className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}</span><span className={done ? "text-foreground" : "text-soft"}>{label}</span></li>;
}
