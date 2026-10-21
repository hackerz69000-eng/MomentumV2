# Momentum study generation stuck-state fix

## What was wrong
Study-set creation calls the notes/flashcard generator synchronously. If the hosting platform ends that request (for example, due to a function/request timeout), the browser receives an error but the server-side catch handler may never run. The study-set row can therefore remain `processing`, so opening the set shows the endless “Generating your study resources” state even though the attempt has failed.

## Change
The create-set page now handles a failed generation request by updating the created set from `processing` to `error`, saving the visible error message, refreshing the set/list queries, and opening the set's status/retry screen. The update is conditional on the row still being `processing`, so it does not overwrite a set that has already transitioned to `ready` or `error`.

## Important limitation
This fixes the stuck status and retry path; it does not by itself increase the hosting platform's maximum function duration or make long multi-chunk AI generation run in the background. If generation still times out, the set should now show a failure instead of spinning forever, and the displayed error can help identify the next bottleneck.
