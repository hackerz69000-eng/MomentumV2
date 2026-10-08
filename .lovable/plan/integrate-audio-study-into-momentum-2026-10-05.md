# Integrate Audio Study into Momentum

## Goal

Add a saved, interactive audio lesson inside every study set. Students can listen, interrupt with contextual questions, request explanations, quiz themselves on the current concept, and resume later without creating a separate tutor or progress system.

## What will be built

1. **Saved audio sessions**
   - Add protected records for each lesson and its conversation/quiz events.
   - Save mode, grounded script, topic sections, audio status, playback position, completion, questions, answers, and quiz outcomes.
   - Prevent duplicate sessions from repeated clicks and retain the script if audio creation fails.

2. **Grounded lesson generation**
   - Add Quick Review, Full Study Session, Deep Dive, and Weak Topics modes.
   - Build lessons from the current set's material, notes, study guide, included lecture transcripts, custom instructions, and existing performance evidence.
   - Hide Weak Topics when there is no reliable performance data.
   - Generate one natural tutor narration with section timing/context, not a two-speaker podcast.

3. **Audio generation and playback**
   - Generate private lesson audio after the script succeeds and store it with the student's set.
   - Support retrying audio independently when speech generation fails.
   - Add play/pause, restart, 15-second skip, progress seeking, elapsed/total time, and 0.75x–2x speed.
   - Save playback position periodically and when leaving the page.

4. **Context-aware interaction**
   - Pause for typed questions and explanation actions based on the current lesson section and recent conversation.
   - Reuse Momentum's source-grounding and custom-instruction rules.
   - Provide Continue, Ask another, simpler explanation, and example actions without duplicating AI Tutor.

5. **Quiz Me integration**
   - Generate one grounded recall question from the section just heard.
   - Reuse the existing four-level Active Recall grader.
   - Save results into existing attempts, activity, Mistake Bank, Weak Topics, readiness, and history.
   - Support Try Again, Show Answer, and Continue Audio.

6. **Momentum entry points**
   - Add Audio Study to the study-set overview and tabs.
   - Add launch actions in Notes, Study Guide, and Study Everything.
   - Allow Study Everything and Momentum Coach to recommend Audio Study where it is useful.
   - Add Audio Study sessions to Study History and reopen the saved session.

## Reliability and verification

- Preserve existing study features and all current data.
- Handle script failure, audio failure, question failure, duplicate clicks, refresh, resume, and completed sessions explicitly.
- Verify both empty-performance and weak-topic states.
- Run focused tests and an authenticated browser flow covering generation, playback controls, questions, Quiz Me, persistence, return-to-session, and regressions across existing study tabs.

## Technical details

- Continue using authenticated TanStack server functions and the existing Lovable AI grounding helpers.
- Reuse the private study-files storage area for generated audio, with per-user access.
- Add only additive database changes with authenticated/service grants and row-level ownership policies.
- Keep the current Momentum tokens, typography, icon language, and compact study-set layout.
