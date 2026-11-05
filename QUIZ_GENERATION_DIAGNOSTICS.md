# Quiz generation diagnostics

Diagnostics are off by default. To collect details for a failed quiz in that browser, open the browser developer console and run:

```js
localStorage.setItem("momentum:quiz-diagnostics", "enabled")
```

Reload Momentum and retry the quiz. Look for `[Momentum quiz generation]` entries in the console. Each response entry records requested/completed counts, batch size, source part number and character count, replacement attempt, candidate/accepted/invalid counts, exact/near/semantic duplicate counts, short question fingerprints, response fingerprints, and a unique request ID. It does not print uploaded source text, question wording, authentication tokens, or API credentials.

To disable diagnostics, run:

```js
localStorage.removeItem("momentum:quiz-diagnostics")
```

Each retry is a new POST with `cache: "no-store"` and its own request ID. Momentum verifies that the server echoes that ID before accepting the response. A repeated `responseFingerprint` with `responseFresh: false` means the returned question set repeated within that batch's retries; a different fingerprint means the response content changed. The source fingerprint is only a comparison key, not a source-content log.

The existing tests simulate duplicate and replacement responses. No live NVIDIA credential was configured during this repair, so real provider behavior still needs confirmation from an enabled diagnostic run.
