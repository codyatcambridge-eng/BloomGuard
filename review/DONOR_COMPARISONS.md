# Concise Donor Comparisons

Compared with SACRED100:

| Donor | Purpose | Diff size | Decision |
|---|---|---:|---|
| `1c6c581` | Active Shorts/Flash handoff | 12 files, +1763/-913 | Manual surgical port |
| `745837a` | Main Dial OFF/Flash ownership correction | 16 files, +2104/-912 | Semantic correction reference; manual port |
| `45ff739` | Watch-player foundation | 20 files, +2787/-982 | Smaller player foundation/reference |
| `8b746f1` | Strongest preserved Watch player | 22 files, +4348/-1000 | Staged manual port; no cherry-pick |

All modify `src/lib/webview-injection-script.ts`; later donors also alter host UI,
settings, historical control docs, and tests. The Flash/Shorts donors delete
SACRED100 recovery tests in a raw tree comparison. This makes wholesale merging or
cherry-picking unacceptable.

Key feature additions observed include bounded Shorts transition veil creation,
arming, release, and intent listeners in `1c6c581`; Main Dial ownership correction
in `745837a`; and Watch identity, candidate discovery, reveal anchoring,
poster/frame classification, ownership handoff, bounded playback sampling, native
snapshot handling, and Watch tests by `8b746f1`.
