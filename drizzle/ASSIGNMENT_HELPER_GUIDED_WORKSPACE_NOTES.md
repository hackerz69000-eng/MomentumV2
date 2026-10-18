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
