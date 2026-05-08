# Bloom Guard MVP Agent Rules

## Mission
Bloom Guard MVP is a YouTube blur-injection stability project. The immediate target is stable behavior on `m.youtube.com` homepage/feed/search regular cards.

## Non-Negotiable MVP Behaviors
- Positive items retain blur through static-thumbnail to video/preview transitions.
- Negative items never gain blur or reveal during static state, transition, scroll, node reuse, or DOM churn.
- Reveal appears only when blur is actually present and correctly owned.
- No duplicate reveal overlays.
- No orphan reveal overlays.
- No wrong-card inheritance.
- Do not touch active Shorts playback unless explicitly instructed by the user.

## Patch Discipline
- One behavior at a time.
- Prefer investigation-only before code changes.
- Small surgical patches only.
- Do not refactor large files just to make them cleaner.
- Do not change unrelated behavior.
- Do not change thresholds or classifier behavior unless explicitly instructed.
- Do not try to fix everything in one pass.

## YouTube DOM Reality
YouTube mobile heavily mutates cards during static-thumbnail to video/preview transitions, including `src`/`style`/`class` churn and descendant video insertion. Assume node reuse and unstable DOM identity.

## Safety Rules for Blur Authority
- Do not transfer blur or reveal authority when card identity is unknown.
- Do not allow old positive state to contaminate negatives.
- Treat unknown identity cautiously.
- Negative purity is more important than positive persistence.

## Diagnostics and Proof
- Every patch should define expected diagnostic markers or runtime proof.
- Build must pass.
- Runtime bundle must be verified when relevant.
- Manual verification must cover positives, negatives, transition churn, scroll away/back, duplicate overlays, orphan overlays, and active Shorts non-regression.

## Stop Conditions
- Stop if active Shorts behavior changes unexpectedly.
- Stop if negatives gain blur.
- Stop if reveal appears without blur.
- Stop if overlay ownership is unknown.
- Stop if patch requires broad refactor.
