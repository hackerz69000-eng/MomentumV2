# Momentum progress fixes

## Quiz counts
- Quiz generation now tops up questions discarded during quality/source validation rather than silently returning a shorter quiz.
- If it still cannot verify the requested count after two top-up attempts, it returns a clear error instead of pretending the shorter quiz satisfies the requested length.
- Comprehensive quizzes also check the final total and fail clearly rather than silently showing a partial quiz.

## Mastery ranks
- Tightened the shared rank thresholds: Novice 0–9, Apprentice 10–24, Adept 25–44, Scholar 45–64, Sage 65–84, Grandmaster 85–100.
- The same ladder is used everywhere. Dashboard shows overall mastery; a set page labels its rank as that set's mastery, so the scope is clear.

## Streak integrity
- Removed the button that manually claimed a streak session.
- Checking a daily goal no longer records study time or extends the streak. A goal checkbox is planning progress, not proof of a completed study activity.
- Streak panel now explains that a real completed quiz, active-recall session, or full flashcard session is required.

## Achievements
- Expanded the achievement set to 20 milestones across flashcards, quizzes, exams, active recall, session count, streak length, and days studied.

## Concept map
- Replaced the passive summary cards with an interactive concept explorer.
- Selecting a concept shows incoming and outgoing relationships; clicking a connected concept navigates through the map.
- Added an active-recall challenge and revealable self-check for each selected concept.

## Verification
- Source edits applied to the project archive.
- Dependency installation, full type-check, production build, lint, and runtime AI integration tests were not run in this environment because dependencies are not installed.
