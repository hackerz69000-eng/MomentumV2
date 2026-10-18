import { createFileRoute } from "@tanstack/react-router";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { analyzeSimilarity, type SimilaritySource } from "@/lib/similarity-report";
import { verifySupabaseAccessToken } from "@/integrations/supabase/verify-token.server";

const MAX_ESSAY_CHARS = 500_000;
const MAX_QUERIES = 4;
const MAX_PAGES = 8;
const MAX_PAGE_BYTES = 1_200_000;
const MAX_SOURCE_CHARS = 120_000;
const REQUEST_TIMEOUT_MS = 7_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|nav|header|footer|aside|form|button|menu|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|nav|header|footer|aside|form|button|menu|dialog)\b[^>]*\/?\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/article|\/section|\/tr|\/blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, entity: string) => {
      const n = entity[0]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(1), 16) : Number.parseInt(entity, 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SOURCE_CHARS);
}

function decodeHtmlTitle(html: string): string | undefined {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1];
  if (!raw) return undefined;
  return htmlToText(raw).replace(/\s+/g, " ").trim().slice(0, 240) || undefined;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0)
      || (a === 192 && b === 2) || (a === 198 && (b === 18 || b === 19 || b === 51))
      || (a === 203 && b === 0) || a >= 224;
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:")
      || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("ff")
      || normalized.startsWith("::ffff:") || !/^2[0-9a-f]{3}:/i.test(normalized);
  }
  return true;
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new Error("Unsupported source URL.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("Private source host blocked.");
  const literalType = isIP(hostname);
  const addresses = literalType ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("Non-public source host blocked.");
  return url;
}

const robotsCache = new Map<string, Promise<boolean>>();

async function robotsAllows(url: URL): Promise<boolean> {
  const origin = url.origin;
  let pending = robotsCache.get(origin);
  if (!pending) {
    pending = (async () => {
      try {
        const robotsUrl = new URL("/robots.txt", origin);
        await assertPublicHttpUrl(robotsUrl.href);
        const response = await fetch(robotsUrl, { redirect: "manual", signal: AbortSignal.timeout(2_500), headers: { "User-Agent": "MomentumSimilarityPrecheck/1.0" } });
        if (response.status === 404 || response.status === 410) return true;
        if (!response.ok || response.status >= 300) return false;
        const text = (await response.text()).slice(0, 64_000);
        let applies = false;
        let disallowed: string[] = [];
        for (const line of text.split(/\r?\n/)) {
          const clean = line.split("#")[0]?.trim() ?? "";
          if (!clean) continue;
          const separator = clean.indexOf(":");
          if (separator < 0) continue;
          const field = clean.slice(0, separator).trim().toLowerCase();
          const value = clean.slice(separator + 1).trim();
          if (field === "user-agent") {
            const agent = value.toLowerCase();
            if (agent === "*" || agent.includes("momentumsimilarityprecheck")) applies = true;
            else if (applies) applies = false;
            continue;
          }
          if (applies && field === "disallow" && value) disallowed.push(value);
        }
        const path = `${url.pathname}${url.search}`;
        return !disallowed.some((rule) => path.startsWith(rule));
      } catch {
        // Fail closed if a robots policy cannot be checked; don't crawl that origin.
        return false;
      }
    })();
    robotsCache.set(origin, pending);
  }
  return pending;
}

async function safeFetchText(rawUrl: string): Promise<{ url: string; title?: string; text: string } | null> {
  let current = rawUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    let url: URL;
    try { url = await assertPublicHttpUrl(current); } catch { return null; }
    if (!(await robotsAllows(url))) return null;
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "User-Agent": "MomentumSimilarityPrecheck/1.0", Accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      });
    } catch { return null; }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) return null;
      try { current = new URL(location, url).href; } catch { return null; }
      continue;
    }
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("text/plain") && !contentType.includes("application/xhtml+xml")) return null;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_PAGE_BYTES) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_PAGE_BYTES) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } catch { return null; }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (contentType.includes("text/plain")) {
      const text = raw.slice(0, MAX_SOURCE_CHARS).trim();
      return text.split(/\s+/).length >= 30 ? { url: url.href, text } : null;
    }
    const html = raw;
    // Prefer semantic main/article content when present to reduce navigation/footer noise.
    const mainContent = /<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)\s*>/i.exec(html)?.[1];
    const text = htmlToText(mainContent || html);
    if (text.split(/\s+/).length < 30) return null;
    const title = decodeHtmlTitle(html);
    return { url: url.href, ...(title ? { title } : {}), text };
  }
  return null;
}


function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, entity: string) => {
      const n = entity[0]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(1), 16) : Number.parseInt(entity, 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(/\s+/g, " ").trim();
}

function reconstructOpenAlexAbstract(index: Record<string, number[]> | undefined): string {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 20_000) words[position] = word;
    }
  }
  return words.filter((word): word is string => typeof word === "string").join(" ").slice(0, MAX_SOURCE_CHARS);
}

function essayQueries(text: string): string[] {
  // Search the essay body rather than references. Sliding windows can find a copied
  // passage in the middle/end of a sentence instead of only its opening words.
  const body = text.replace(/^\s*(?:references|works cited|bibliography|literature cited)\s*:?\s*[\s\S]*$/im, "");
  const wordPattern = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  const tokens = [...body.matchAll(wordPattern)].map((match) => ({
    value: match[0].toLocaleLowerCase(),
    raw: match[0],
    index: match.index ?? 0,
  }));
  if (tokens.length < 9) return [];

  const frequency = new Map<string, number>();
  for (const token of tokens) frequency.set(token.value, (frequency.get(token.value) ?? 0) + 1);
  const common = new Set("the a an and or but if then than to of in on for from with by as at is are was were be been being it its this that these those we they you i he she their our your can could should would may might will not no do does did have has had about into over after before between through during because while where when which who what how also very more most some any each other another such".split(" "));
  const candidates: Array<{ phrase: string; score: number; position: number; signature: string }> = [];
  const seen = new Set<string>();
  // 12-16 word windows are long enough to be distinctive but short enough for search
  // providers. Move in five-word steps so multiple windows can cover one long sentence.
  for (let size = 12; size >= 9; size -= 3) {
    for (let i = 0; i + size <= tokens.length; i += 5) {
      const window = tokens.slice(i, i + size);
      const content = window.filter((token) => !common.has(token.value));
      if (content.length < 5) continue;
      const phrase = window.map((token) => token.raw).join(" ");
      if (phrase.length > 190 || phrase.length < 45) continue;
      const signature = window.map((token) => token.value).join(" ");
      if (seen.has(signature)) continue;
      seen.add(signature);
      const rarity = content.reduce((sum, token) => sum + 1 / Math.sqrt(frequency.get(token.value) ?? 1), 0);
      const uniqueContent = new Set(content.map((token) => token.value)).size / content.length;
      const repetitionPenalty = (frequency.get(window[0]?.value ?? "") ?? 1) > 6 ? 0.8 : 1;
      candidates.push({
        phrase,
        position: window[0]?.index ?? i,
        signature,
        score: (rarity / Math.sqrt(content.length) + uniqueContent * 0.8) * repetitionPenalty,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen: typeof candidates = [];
  for (const candidate of candidates) {
    // Avoid querying essentially the same passage twice, even when different window
    // lengths produced a high score for it.
    const nearDuplicate = chosen.some((item) => {
      const distance = Math.abs(item.position - candidate.position);
      if (distance < 100) return true;
      const shorter = item.signature.length < candidate.signature.length ? item.signature : candidate.signature;
      const longer = item.signature.length >= candidate.signature.length ? item.signature : candidate.signature;
      return shorter.length > 0 && longer.includes(shorter);
    });
    if (!nearDuplicate) chosen.push(candidate);
    if (chosen.length >= MAX_QUERIES) break;
  }
  return chosen.map((item) => item.phrase);
}

type BraveResult = { title?: string; url?: string; description?: string };

async function braveSearch(query: string, key: string): Promise<BraveResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", `"${query}"`);
  url.searchParams.set("count", "5");
  url.searchParams.set("safesearch", "moderate");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return [];
  const data = await response.json() as { web?: { results?: BraveResult[] } };
  return (data.web?.results ?? []).filter((result) => typeof result.url === "string" && typeof result.title === "string");
}

type CrossrefWork = { DOI?: string; title?: string[]; URL?: string; abstract?: string; type?: string; "container-title"?: string[]; author?: Array<{ given?: string; family?: string }>; published?: { "date-parts"?: number[][] } };

async function crossrefSearch(query: string): Promise<CrossrefWork[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", "5");
  url.searchParams.set("select", "DOI,title,URL,abstract,type,container-title,author,published");
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "MomentumSimilarityPrecheck/1.0" }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return [];
  const data = await response.json() as { message?: { items?: CrossrefWork[] } };
  return data.message?.items ?? [];
}


type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string | null } | null;
  best_oa_location?: { landing_page_url?: string | null; pdf_url?: string | null } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
};

async function openAlexSearch(query: string): Promise<OpenAlexWork[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", "5");
  url.searchParams.set("select", "id,doi,title,publication_year,abstract_inverted_index,primary_location,best_oa_location,open_access");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "MomentumSimilarityPrecheck/1.0" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return [];
  const data = await response.json() as { results?: OpenAlexWork[] };
  return data.results ?? [];
}

type EuropePmcResult = { title?: string; pmcid?: string; doi?: string; authorString?: string; abstractText?: string; firstPublicationDate?: string };

async function europePmcSearch(query: string): Promise<EuropePmcResult[]> {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", `OPEN_ACCESS:Y AND (TITLE:"${query.replace(/["\\]/g, " ")}" OR ABSTRACT:"${query.replace(/["\\]/g, " ")}")`);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", "4");
  url.searchParams.set("resultType", "core");
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return [];
  const data = await response.json() as { resultList?: { result?: EuropePmcResult[] } };
  return data.resultList?.result ?? [];
}

async function europePmcFullText(pmcid: string): Promise<string> {
  if (!/^PMC\d+$/i.test(pmcid)) return "";
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/xml,text/xml" }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return "";
    const raw = (await response.text()).slice(0, MAX_PAGE_BYTES);
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(raw)?.[1] ?? raw;
    return decodeXmlText(body).slice(0, MAX_SOURCE_CHARS);
  } catch { return ""; }
}


type ArxivWork = { id: string; title: string; summary: string; abstractUrl: string; htmlUrl: string };

function xmlField(entry: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const raw = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i").exec(entry)?.[1] ?? "";
  return decodeXmlText(raw);
}

async function arxivSearch(query: string): Promise<ArxivWork[]> {
  const terms = [...new Set((query.match(/[\p{L}\p{N}]{4,}/gu) ?? []).map((term) => term.toLowerCase()))].slice(0, 5);
  if (terms.length < 2) return [];
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", terms.map((term) => `all:${term}`).join("+AND+"));
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "4");
  url.searchParams.set("sortBy", "relevance");
  try {
    const response = await fetch(url, { headers: { Accept: "application/atom+xml,application/xml" }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return [];
    const xml = (await response.text()).slice(0, MAX_PAGE_BYTES);
    return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi)].flatMap((match) => {
      const entry = match[1] ?? "";
      const rawId = xmlField(entry, "id");
      const title = xmlField(entry, "title").replace(/\s+/g, " ").trim();
      const summary = xmlField(entry, "summary");
      const idMatch = /arxiv\.org\/(?:abs|pdf)\/([0-9.]+(?:v\d+)?)/i.exec(rawId);
      if (!idMatch || !title || summary.split(/\s+/).length < 8) return [];
      const id = idMatch[1]!.replace(/v\d+$/i, "");
      return [{ id, title: title.slice(0, 240), summary, abstractUrl: `https://arxiv.org/abs/${id}`, htmlUrl: `https://ar5iv.labs.arxiv.org/html/${id}` }];
    });
  } catch { return []; }
}

async function authenticatedUserId(request: Request): Promise<string | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  try {
    const user = await verifySupabaseAccessToken(token);
    return user?.id ?? null;
  } catch { return null; }
}

// Best-effort per-instance throttling protects the optional search provider from accidental
// repeated calls. A production deployment should also configure platform-level rate limits.
const recentSearches = new Map<string, number[]>();

export const Route = createFileRoute("/api/similarity-discovery")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await authenticatedUserId(request);
        if (!userId) return json({ error: "Please sign in again before searching public sources." }, 401);
        const now = Date.now();
        const recent = (recentSearches.get(userId) ?? []).filter((time) => now - time < 10 * 60 * 1000);
        if (recent.length >= 3) return json({ error: "You've run several source searches recently. Wait a few minutes before trying again." }, 429);
        recent.push(now);
        recentSearches.set(userId, recent);
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > MAX_ESSAY_CHARS * 2) return json({ error: "Essay is too large for a similarity search." }, 413);
        let body: { essayText?: unknown; consent?: unknown };
        try { body = await request.json() as typeof body; } catch { return json({ error: "Invalid request body." }, 400); }
        if (body.consent !== true) return json({ error: "Consent is required before sending essay excerpts to public search." }, 400);
        if (typeof body.essayText !== "string" || body.essayText.trim().length < 100 || body.essayText.length > MAX_ESSAY_CHARS) {
          return json({ error: "Provide an essay between 100 characters and 500,000 characters." }, 400);
        }
        const essayText = body.essayText;
        const queries = essayQueries(essayText);
        if (!queries.length) return json({ error: "Not enough sentence-like text was found to form useful search queries." }, 400);

        const braveKey = process.env["BRAVE_SEARCH_API_KEY"];
        const sourceMap = new Map<string, SimilaritySource & { coverage?: "full-page" | "search-snippet" | "abstract" }>();
        const providers = { publicWeb: !!braveKey, scholarlyMetadata: false, openAlex: false, arxiv: false, openAccessFullText: false };
        const providerWarnings: string[] = [];

        if (braveKey) {
          const resultBatches = await Promise.all(queries.map((query) => braveSearch(query, braveKey).catch(() => [])));
          const results = resultBatches.flat();
          const uniqueResults = [...new Map(results.map((item) => {
            try { const url = new URL(item.url!); url.hash = ""; url.search = ""; return [url.href, item] as const; }
            catch { return [`invalid:${item.url}`, item] as const; }
          })).values()].slice(0, MAX_PAGES);
          const fetched = await Promise.all(uniqueResults.map(async (result) => {
            const fallbackUrl = result.url;
            if (!fallbackUrl) return null;
            const page = await safeFetchText(fallbackUrl);
            if (page && page.text.split(/\s+/).length >= 30) {
              return { id: `web:${page.url}`, title: page.title || result.title || new URL(page.url).hostname, text: page.text, kind: "internet" as const, url: page.url, coverage: "full-page" as const };
            }
            const snippet = result.description?.trim() ?? "";
            if (snippet.split(/\s+/).length >= 8) {
              let safeUrl: string;
              try { safeUrl = (await assertPublicHttpUrl(fallbackUrl)).href; } catch { return null; }
              return { id: `web-snippet:${safeUrl}`, title: result.title || new URL(safeUrl).hostname, text: snippet, kind: "internet" as const, url: safeUrl, coverage: "search-snippet" as const };
            }
            return null;
          }));
          for (const source of fetched) if (source && !sourceMap.has(source.id)) sourceMap.set(source.id, source);
          if (!sourceMap.size) providerWarnings.push("Public web search returned no readable pages or usable snippets for the selected phrases.");
        } else {
          providerWarnings.push("Public web search is not configured on this deployment. Add BRAVE_SEARCH_API_KEY in Vercel to search the public web; scholarly metadata search remains available.");
        }

        const scholarlyQueries = queries.slice(0, 3).map((query) => query.split(/\s+/).slice(0, 10).join(" "));
        const workBatches = await Promise.all(scholarlyQueries.map((query) => crossrefSearch(query).catch(() => [])));
        providers.scholarlyMetadata = workBatches.some((batch) => batch.length > 0);
        for (const work of workBatches.flat()) {
          const title = work.title?.[0];
          if (!work.abstract || !title) continue;
          const abstract = htmlToText(work.abstract);
          if (abstract.split(/\s+/).length < 8) continue;
          const candidateUrl = work.URL || (work.DOI ? `https://doi.org/${work.DOI}` : undefined);
          let url: string | undefined;
          if (candidateUrl) {
            try {
              const parsedUrl = new URL(candidateUrl);
              if ((parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") && !parsedUrl.username && !parsedUrl.password) url = parsedUrl.href;
            } catch { /* Ignore malformed publication URLs. */ }
          }
          const id = `publication:${work.DOI || url || title}`;
          if (sourceMap.has(id)) continue;
          sourceMap.set(id, { id, title: title.slice(0, 240), text: abstract, kind: "publication", ...(url ? { url } : {}), coverage: "abstract" });
          if (sourceMap.size >= MAX_PAGES + 6) break;
        }
        if (!workBatches.flat().some((work) => !!work.abstract)) providerWarnings.push("Crossref returned no searchable abstracts for these queries. Many scholarly records expose metadata but not full text.");

        // OpenAlex broadens academic discovery beyond Crossref and commonly exposes
        // abstracts as inverted indexes. Abstract matches are explicitly labeled; they
        // are not misrepresented as full-paper comparisons.
        const openAlexBatches = await Promise.all(scholarlyQueries.map((query) => openAlexSearch(query).catch(() => [])));
        const openAlexWorks = openAlexBatches.flat();
        providers.openAlex = openAlexWorks.length > 0;
        // Try a small bounded set of openly accessible landing pages. Only readable
        // HTML/text is accepted here; inaccessible, paywalled, PDF-only, or robots-blocked
        // sources fall back to the provider's abstract instead of being mislabelled.
        const openAlexFullTextEntries = await Promise.all(openAlexWorks
          .filter((work) => work.open_access?.is_oa && (work.best_oa_location?.landing_page_url || work.open_access?.oa_url || work.primary_location?.landing_page_url))
          .slice(0, 3)
          .map(async (work) => {
            const url = work.best_oa_location?.landing_page_url || work.open_access?.oa_url || work.primary_location?.landing_page_url;
            if (!url || !work.id) return null;
            const page = await safeFetchText(url);
            return page && page.text.split(/\s+/).length >= 100 ? { id: work.id, page } : null;
          }));
        const openAlexFullTextById = new Map(openAlexFullTextEntries.filter((entry): entry is NonNullable<typeof entry> => !!entry).map((entry) => [entry.id, entry.page]));
        providers.openAccessFullText = openAlexFullTextById.size > 0;
        for (const work of openAlexWorks) {
          const title = work.title?.trim();
          if (!title) continue;
          const abstract = reconstructOpenAlexAbstract(work.abstract_inverted_index ?? undefined);
          const fullPage = work.id ? openAlexFullTextById.get(work.id) : undefined;
          const text = fullPage?.text ?? abstract;
          if (text.split(/\s+/).length < 8) continue;
          const url = fullPage?.url || work.best_oa_location?.landing_page_url || work.open_access?.oa_url || work.primary_location?.landing_page_url || work.doi || work.id;
          const id = `openalex:${work.id || work.doi || title}`;
          if (sourceMap.has(id)) continue;
          sourceMap.set(id, { id, title: title.slice(0, 240), text, kind: "publication", ...(url ? { url } : {}), coverage: fullPage ? "full-page" : "abstract" });
          if (sourceMap.size >= MAX_PAGES + 10) break;
        }

        // Europe PMC offers full text XML for many openly accessible biomedical papers.
        // Fetch only identified PMC records and keep each full-text retrieval bounded.
        const epmcBatches = await Promise.all(scholarlyQueries.map((query) => europePmcSearch(query).catch(() => [])));
        const epmcWorks = [...new Map(epmcBatches.flat().filter((work) => !!work.pmcid).map((work) => [work.pmcid!, work])).values()].slice(0, 4);
        const epmcSources = await Promise.all(epmcWorks.map(async (work) => {
          const title = work.title?.trim();
          const pmcid = work.pmcid;
          if (!title || !pmcid) return null;
          const fullText = await europePmcFullText(pmcid);
          const abstract = work.abstractText ? decodeXmlText(work.abstractText) : "";
          const text = fullText.split(/\s+/).length >= 100 ? fullText : abstract;
          if (text.split(/\s+/).length < 8) return null;
          const id = `europepmc:${pmcid}`;
          const doi = work.doi ? `https://doi.org/${work.doi}` : `https://europepmc.org/articles/${pmcid}`;
          return { id, title: title.slice(0, 240), text, kind: "publication" as const, url: doi, coverage: (text === fullText ? "full-page" : "abstract") as "full-page" | "abstract" };
        }));
        providers.openAccessFullText = providers.openAccessFullText || epmcSources.some((source) => source?.coverage === "full-page");
        for (const source of epmcSources) {
          if (source && !sourceMap.has(source.id)) sourceMap.set(source.id, source);
          if (sourceMap.size >= MAX_PAGES + 16) break;
        }
        // arXiv adds open research preprints across physics, mathematics, computer
        // science, economics, and adjacent fields. Attempt a tiny number of HTML full-text
        // fetches through ar5iv, honoring robots.txt and keeping abstracts as the fallback.
        const arxivBatches = await Promise.all(scholarlyQueries.slice(0, 2).map((query) => arxivSearch(query).catch(() => [])));
        const arxivWorks = [...new Map(arxivBatches.flat().map((work) => [work.id, work])).values()].slice(0, 4);
        providers.arxiv = arxivWorks.length > 0;
        const arxivFullTexts = await Promise.all(arxivWorks.slice(0, 2).map(async (work) => {
          const page = await safeFetchText(work.htmlUrl);
          return page && page.text.split(/\s+/).length >= 100 ? { id: work.id, page } : null;
        }));
        const arxivFullTextById = new Map(arxivFullTexts.filter((entry): entry is NonNullable<typeof entry> => !!entry).map((entry) => [entry.id, entry.page]));
        providers.openAccessFullText = providers.openAccessFullText || arxivFullTextById.size > 0;
        for (const work of arxivWorks) {
          const page = arxivFullTextById.get(work.id);
          const text = page?.text ?? work.summary;
          const id = `arxiv:${work.id}`;
          if (!sourceMap.has(id) && text.split(/\s+/).length >= 8) {
            sourceMap.set(id, { id, title: work.title, text, kind: "publication", url: page?.url || work.abstractUrl, coverage: page ? "full-page" : "abstract" });
          }
          if (sourceMap.size >= MAX_PAGES + 16) break;
        }
        if (!workBatches.flat().length) providerWarnings.push("Crossref returned no records for these excerpts; many scholarly records expose metadata but not readable abstracts.");
        if (!openAlexBatches.flat().length) providerWarnings.push("OpenAlex academic search returned no records for these excerpts.");
        if (!epmcWorks.length) providerWarnings.push("Europe PMC did not find openly accessible full-text records for these excerpts; this provider mainly covers biomedical and life-science research.");
        if (!arxivWorks.length) providerWarnings.push("arXiv did not return relevant open preprints for these excerpts.");

        const sources = [...sourceMap.values()].slice(0, MAX_PAGES + 16);
        if (!sources.length) return json({ error: "No comparison text could be retrieved. Add BRAVE_SEARCH_API_KEY for public-web search, or add your own source documents.", providers, providerWarnings, queryCount: queries.length }, 200);
        const analysis = analyzeSimilarity(essayText, sources, 8);
        const matchLimit = 500;
        const matchesTruncated = analysis.matches.length > matchLimit;
        const excerptCounts = new Map<string, number>();
        const returnedMatches = analysis.matches.slice(0, matchLimit).map((match) => {
          const count = excerptCounts.get(match.sourceId) ?? 0;
          excerptCounts.set(match.sourceId, count + 1);
          // Return a few short source excerpts per source, not copied full-page text.
          const { sourceSnippet, ...matchWithoutSourceSnippet } = match;
          return count < 3 && sourceSnippet ? { ...matchWithoutSourceSnippet, sourceSnippet: sourceSnippet.slice(0, 350) } : matchWithoutSourceSnippet;
        });
        const returnedSources = analysis.sources;
        // Never send full retrieved source text back to the browser; only source metadata and
        // matched snippets are returned. Essay content and query excerpts are not persisted.
        return json({
          providers,
          providerWarnings,
          queryCount: queries.length,
          sourceCount: sources.length,
          coverageSummary: {
            fullPages: sources.filter((source) => source.coverage === "full-page" && source.kind === "internet").length,
            searchSnippets: sources.filter((source) => source.coverage === "search-snippet").length,
            abstracts: sources.filter((source) => source.coverage === "abstract").length,
            openAccessFullTexts: sources.filter((source) => source.coverage === "full-page" && source.kind === "publication").length,
          },
          analysis: {
            wordCount: analysis.wordCount,
            matches: returnedMatches,
            matchesTruncated,
            sources: returnedSources,
            // Preserve the complete document-level score even if passage detail is capped.
            matchedWordIndexes: analysis.matchedWordIndexes,
            percentage: analysis.percentage,
            coverageNote: analysis.coverageNote,
          },
        });
      },
    },
  },
});
