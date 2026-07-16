# Revert Points — July 14–16, 2026

Written as `work/exit-white-thumbs-t3` (tagged `wip-exitwhite2-abandoned-2026-07-16`) is
being abandoned. All refs below are pushed to GitHub.

## Recommended revert targets (stable, in order)

| Rank | Ref | Commit | What it is |
|------|-----|--------|------------|
| 1 | `phase0-positive-blur-strict-freeze-2026-07-15` | `b1ff2e84` | **The strict freeze seal.** Golden suite green, positive-blur core sealed. The sanctioned home per FROZEN.md. |
| 2 | `phase0-behavior-nosoft-p0off-2a6d9c23` | `2a6d9c23` | Behavior-only tip under the seal (no seal docs/tooling). Identical runtime behavior. |
| 3 | `MVPCANDIDATE12-nosoft-p0off` / `phase0-mvp-lifecycle-2026-07-15` | `0ad97257` | Freeze landing commit right after the behavior tip. |
| 4 | `nosoft-exit-mvp` | `da155436` | July 14 ladder top: soft-preblur ban + all-Shorts-exit polish (pre-p0off). |
| 5 | `MVPCANDIATE11` | `c7e32dcf` | July 14 candidate build (pre-orphanfix/partial2/nosoft). |

## The abandoned head (kept on GitHub for salvage)

Branch `work/exit-white-thumbs-t3`, tag `wip-exitwhite2-abandoned-2026-07-16` = `ae708eb7`:

- `0f0b3046` exitwhite1 — feed veil suppress/clear + verdict-less dedup release (did NOT fix device bug)
- `6d1f924d` exitwhite2 — stale off-Shorts frame-verdict gate + frame-capture orphan frost clear (device outcome unconfirmed when abandoned)
- `66fece26` gitignore build/sim-dd, `ae708eb7` dashboard marker

Investigation results worth keeping regardless of head (from live device log capture):
the white shelf thumbs come from in-flight Active Shorts **video-frame verdicts
(data-URI src)** landing after exit and hard-blurring recycled shelf preview videos;
the regular reveal fallback is scope-blocked for shelf videos
(`revealFallbackScopeEligible` excludes `isHomeShortsShelfVideo`), so the frost has
no reveal and survives until DOM recycle. Markers seen: `reveal_fallback_skipped_scope
scope=shorts_or_quarantined`, `blur_without_reveal contextSrcKey=data:image/jpeg`,
host `moderation_request_shorts_item_blur` on `m.youtube.com`.

## July 14 ladder (ancestors of the seal — also revertable)

`fb1fde8b` partial2-exit-scrub · `367a398b` orphanfix-blur-reveal · `0850016f`
exitsoft-partial-blur · `835343cf` sacc3 · `0ebcdddc` rev2 · `aaba410f` sacc2 ·
`6d18941e` sacc · `cbc570ff` watch1 · `1be76366` acc2 · `8918783e` rev1 ·
`40956669` sframe · `9f5caed6` life2 · `0b20dda4` mvpnear (`Hopppper`)

## Do NOT revert to (known-bad)

- `79598413` and its chain (exitfix2/v3) — fully reverted for cause
- `250de303` / `3999d8af` (noblack) — introduced black-screen bug, hard reset
- `eeff5348` (`wip-buggy-s1-stack-2026-07-15`) — buggy S1 stack
- `f82f23b6` (exitfix1 line) — abandoned by reset on 07-16 01:41

## Side branches with salvage value (single-lane, on behavior tip)

- `work/dial-first-launch-fix` (`b95a6260`) — cold dial re-seat (residual ticket #1)
- `work/active-shorts-accuracy` (`323f3049`, on origin) — sacc4 accuracy (ticket #4)
