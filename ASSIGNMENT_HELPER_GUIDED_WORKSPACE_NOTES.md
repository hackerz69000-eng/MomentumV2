# Momentum Assignment Helper — readability and workflow update

## What changed

- Understand It, Brainstorm, and Outline prompts now prioritize concise, scannable guidance, short paragraphs, real Markdown lists, and whitespace between sections.
- The prompts explicitly prohibit table layouts, escaped pipe characters, raw HTML, and literal `<br>` tags. They require a clear distinction between teacher-stated requirements and Momentum's suggestions.
- Understand It now avoids repeating deadlines, word counts, and formatting details in multiple sections. Rubric point values must come from supplied instructions; inferred self-checks must not be presented as official rubrics.
- Brainstorm options use a consistent compact structure and preserve the student's right to choose or reject a direction.
- Outline guidance remains adaptable to the assignment type, distinguishes a provisional direction from the student's own thesis, and treats time/length estimates as optional suggestions.
- Existing Assignment Helper results and feedback chat are normalized before rendering. Flattened/escaped Markdown tables are converted into readable nested lists, and literal `<br>` tags are removed rather than shown to students.
- Step time suggestions now adapt to assignment-instruction length, word-count targets, checklist density, and complexity cues. They are labelled optional, with explanatory UI text that they are not timers or requirements.
- Added a regression test for the flattened table/`<br>` case reported by the user.

## Verification

- Manually exercised the Markdown formatter against both the existing study-guide table case and the reported Assignment Helper-style flattened table; both rendered as readable lists with no raw pipe-table syntax or `<br>` tag.
- TypeScript/TSX syntax transpilation checks are run for the changed source files.
- A full application build and Vitest suite require installing the project's dependencies first; they are not claimed as passing unless run in an environment with dependencies installed.

## Open-ended assignment help

- The Assignment Helper conversation now accepts questions before a student has written a draft; an empty draft no longer blocks the chat.
- Students can ask about the prompt, course concepts, planning, possible arguments, structure, evidence, citation questions, research strategy, teacher feedback, or draft revision.
- Responses use the current assignment instructions, rubric, permitted source bundle and limits, notes, chosen argument, generated guides, draft (if present), and recent conversation history where relevant.
- The helper is instructed to answer the actual question rather than forcing every response into a draft-review template. It should identify missing context, avoid invented requirements/citations/source claims, respect source restrictions, and coach rather than write the whole assignment.
- Updated the UI label, explanatory text, placeholder, accessible button label, and send-button guard so students can ask without a draft.

## Verification for open-ended assignment help

- Reviewed the modified server and UI code paths. A full TypeScript build and automated test suite have not been run in this environment because project dependencies are not installed.

## Final usability and accessibility pass

- The Ask for help tab now includes starter-question chips, speaker labels, a visible response-loading state, and automatic scrolling to the newest conversation content.
- The question composer is a multiline textarea with a 3,000-character limit, a live character count, Enter-to-send, and Shift+Enter for a new line.
- Added tab/tabpanel relationships and selected-tab keyboard focus semantics for clearer assistive-technology navigation.
- The tutor can now answer a question even when assignment instructions have not been entered yet. It is instructed to be transparent that it has not seen the prompt and still help from the student's question rather than refusing outright.
- Persisted chat history is filtered to valid user/assistant messages before it is passed back to the model.
- Validation: TypeScript transpilation/syntax checks passed for all 161 `.ts`/`.tsx` source files. A full typecheck, production build, lint, automated test suite, and live model round-trip remain unverified because dependencies could not be installed in this environment.
