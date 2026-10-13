# Assignment Helper Guided Workspace Improvements

## Student experience
- Reworked the Assignment Helper stage cards for Understand, Brainstorm, and Outline. Each stage explains its purpose, what the student will receive, and a realistic review-time estimate.
- Each stage has a dedicated Generate/Regenerate action and saved-state indicator. Results can be revisited from the workspace tabs without losing earlier generated work.
- Added a more useful empty state that explains what the selected stage will do.
- Renamed the feedback area to "Review and improve" and explained that feedback is available for drafts or partial sections, with prioritized actions rather than a rewrite.
- Improved Markdown styles for nested lists, heading hierarchy, links, code blocks, and checklists.

## AI guidance
- Understand it: generates a plain-language explanation of the assignment, concrete deliverables, explicit format and length, actual rubric criteria (or a clearly labeled inferred self-check), key questions, source restrictions, common traps, time-estimated steps with move-on conditions, missing information, and first actions.
- Brainstorm: explores multiple distinct possible directions, reflects student ideas first, separates verified evidence from material to investigate, explains possible counterarguments, and gives a quick brainstorming exercise. It does not force a thesis or present an unchosen thesis as the student's own.
- Outline: adapts to the actual deliverable, provides a section-by-section plan with purpose, points to include, permitted evidence, reasoning questions, and next actions. If the student has not chosen an argument, it provides clearly provisional options instead of blocking.
- Draft feedback: prioritizes specific fixes, identifies strengths, checks requirements when known, flags claims/citations to verify, and provides the student's next three revision actions without rewriting the whole draft.
- All prompts request concise, scannable Markdown, prohibit raw HTML and Markdown tables, distinguish teacher requirements from Momentum suggestions, and preserve source restrictions.

## Validation
- TypeScript transpilation syntax checks passed for the modified TSX and server-function files.
- Full application build and integration tests were not run because project dependencies are not installed in this environment. Run `npm install` and `npm run build` before deployment.
