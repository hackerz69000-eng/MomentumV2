# Turnitin Submission Practice workflow

This page intentionally models the common student submission sequence while clearly remaining a practice simulation. It is not a Turnitin integration and must not represent a practice action as an official upload, receipt, submission ID, or Similarity Report.

## Workflow covered

- Assignment details and title
- Standard assignment and Standard (Classic) interface selection
- Upload submission and, in Classic practice mode, Text Input
- Cloud submission option with an honest notice that no cloud provider is connected
- Upload and Review step
- Local preview where possible (PDF viewer, TXT extraction, DOCX text extraction)
- Optional consent-gated similarity pre-check against user-provided text, accessible public-web pages (when Brave Search is configured), Crossref and OpenAlex scholarly metadata/abstracts, and Europe PMC open-access full text where available
- Final practice confirmation with an explicit `NOT SUBMITTED TO TURNITIN` state
- Optional link to open the institution's official assignment page

## File checks and limitations

Turnitin's published student file requirements for assignments that generate Similarity Reports include files smaller than 100 MB, fewer than 800 pages, and at least 20 words. Common supported formats include DOC/DOCX, PDF with selectable text, TXT, RTF, ODT, HWP/HWPX, PPTX/PPSX/PPS, HTML, and PostScript. Assignment configuration and institution integration can affect what is accepted. This UI checks file extension and byte size but cannot reliably inspect page count, instructor settings, or whether every PDF is text-selectable. Scanned/image-only PDFs may not generate a Similarity Report.

## Official reference pages consulted

- Turnitin Guides, “Submitting to a Standard assignment”: https://guides.turnitin.com/hc/en-us/articles/22049882775821-Submitting-to-a-Standard-assignment
- Turnitin Guides, “File requirements for submitting your assignment to Turnitin”: https://guides.turnitin.com/hc/en-us/articles/22047038689037-File-requirements-for-student-submission

## Privacy / integration note

Local-only comparison keeps the essay in the browser. If a student explicitly opts into public-source discovery, the essay is sent to the Momentum server for one-time matching and up to four short excerpts are sent as queries to configured public search services. This feature does not intentionally persist the essay or retrieved page text, but production hosting, logging, and third-party providers may have separate retention policies. No essay is sent to Turnitin and no official submission record is created. A real submission requires the student's institution-authorized Turnitin or LMS assignment workflow; exact UI, options, deadlines, and resubmission behavior are configured by the institution/instructor.

## Similarity matching engine notes

The independent local matcher uses normalized word tokens and 7-, 5-, and 4-word exact shingles as anchors, then extends matching passages across isolated substitutions and short inserted/deleted phrases. Only equal word tokens contribute to the similarity score or confirmed-match highlighting. Overall score accounting deduplicates essay word positions across overlapping sources. Source discovery combines accessible web pages when Brave Search is configured, Crossref and OpenAlex scholarly abstracts, robots-permitted OpenAlex open-access landing pages, and Europe PMC open-access full text when available. Coverage is limited to accessible sources; this is an independent heuristic, not Turnitin code, and it has not been calibrated against a representative set of official reports.
