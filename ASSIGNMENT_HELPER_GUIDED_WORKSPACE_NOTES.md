# Assignment Helper Guided Workspace Update

## What's included
- Multi-file upload in Assignment Helper for assignment instructions, allowed/required sources, supporting class materials/teacher feedback, and a student's draft.
- PDF, DOCX, PPTX, TXT/Markdown, and common image extraction reuses the project's existing file extraction/OCR path; the 20 MB per-file limit is enforced with per-file errors.
- Optional source notes and uploaded source cards with filename, category, extracted character count, remove action, and a permitted-use note.
- Source limits can specify chapter, PDF page range, or section. When page numbering is ambiguous or the allowed section cannot be isolated from the extracted text, the AI receives an instruction not to use the full source and to ask for the allowed excerpt.
- Assignment guidelines remain the required starting point. Sources, ideas, and drafts are optional and can be added later.
- Removed the separate rubric field from the visible Assignment Helper form. The AI is instructed to extract rubric criteria from the teacher's guidelines or label any derived checklist as inferred when no rubric is supplied.
- AI prompts request concise, well-structured Markdown, explicit source boundaries, and clear next actions rather than a wall of text.
- Existing assignments using plain text in the `sources` field remain supported. New multi-file source bundles are serialized into the existing `sources` text column, so no database migration is required.

## Validation
- The three changed TypeScript/TSX files passed TypeScript transpilation syntax checks.
- A full application build/type-check could not be completed in this environment because project dependencies are not installed. Run `npm install` and `npm run build` in the project before deploying.
