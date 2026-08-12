CODEX INSTRUCTION — REPLACE THE EXISTING AGENTS.md
Delete the existing AGENTS.md and replace it completely with this file.
This file is now the authoritative BloomGuard MVP product and engineering contract.
Do not merge this with the previous AGENTS.md. Do not preserve obsolete requirements from the old file unless they are also present here.
The objective is to get BloomGuard to a stable MVP, not to expand the product or repeatedly rewrite working systems.

CODEX MVP EXECUTION ORDER
Phase 0 — Core Engine First
Do not build new features until Phase 0 is stable.
Stabilize the existing Main Blur / Detection + Main Dial:
* Stable positive blur.
* Clean negatives.
* Reliable reveal.
* Main Dial ON/OFF works correctly.
* Main Dial survives all lifecycle events.
* Works on Home, Search, Watch recommendations, Shorts shelves, Shorts posters, and Active Shorts.
* No blur drops, stale blur, orphan reveals, or lifecycle regressions.
* Active Shorts must use the same Main Blur engine and Main Dial.
Phase 0 Test Gate
Test:
* Home
* Search
* Watch
* Shorts shelves
* Active Shorts
* scrolling
* navigation
* DOM replacement
* refresh
* background/foreground
* long inactivity
* Shorts entry/exit/re-entry
* Main Dial ON/OFF
Verify:
positives stay blurred + negatives stay clean + every blur has reveal + Main Dial state never changes unexpectedly.
If any test fails, fix Phase 0 before continuing.

Phase 0 Zero-Flash Boundary
* Phase 0 stabilizes Main Blur / Detection and the Main Dial; Flash Shield remains a Phase 1 feature.
* Full Flash-Shield-level zero-flash behavior is not required to complete Phase 0 when Flash Shield has not yet been implemented.
* Phase 0 must not introduce new visual flashes or regress any existing pre-protection behavior.
* Full zero-flash acceptance becomes mandatory when Flash Shield is implemented in Phase 1.
* Do not secretly implement Flash Shield during Phase 0 merely to satisfy the later full-MVP zero-flash Definition of Done.

Phase 0 Freeze
When Phase 0 passes:
Freeze the Main Blur / Detection engine in FROZEN.md.
Protect:
* Main Blur
* Main Dial
* positive ownership
* negative safety
* reveal
* Active Shorts
* lifecycle behavior
Phase 1 must integrate with this frozen behavior.
Do not rewrite or destabilize the Main Blur engine to add new features.
Any Phase 0 change after freezing requires a reproducible MVP bug, a surgical fix, and the full Phase 0 regression test.

Phase 1 — Remaining MVP Features
Implement one feature at a time:
1. Flash Shield — zero-flash pre-blur + independent toggle.
2. Video Player Protection — extend Main Blur into the YouTube player.
3. High-Velocity Scanning — faster scanning + intuitive settings dial.
4. Progressive Tunnel Vision — timed whole-screen progressive blur.
After every Phase 1 feature, rerun the Phase 0 regression test.
If a new feature breaks Phase 0, stop and fix the regression before continuing.

Codex Rules
* Inspect existing code before modifying it.
* Extend existing systems before creating new ones.
* Do not create competing blur engines.
* Main Blur is the source of truth for item protection.
* User settings are authoritative; lifecycle events never reset them.
* Keep patches surgical.
* Do not refactor stable systems without an MVP blocker.
* Do not add features outside this contract.
* Do not call MVP complete from tests alone; verify real YouTube behavior.
Order: Stabilize → Test → Freeze → Add one feature → Regression test → Repeat → Final MVP test.

BloomGuard — MVP Agent Contract
Mission
BloomGuard is a YouTube visual-protection system.
Phase 0 goal: reliably prevent unwanted visual exposure while keeping safe content clean.
Do not expand the product until the behaviors below are stable.

1. SYSTEM OWNERSHIP
BloomGuard has one canonical item-level protection system:
Main Blur / Detection = source of truth for whether content is protected.
Other systems are supporting layers:
* Flash Shield = prevents initial visual exposure.
* High-Velocity Scanning = controls how quickly content is evaluated.
* Video Player Protection = extends Main Blur protection into the actual player.
* Active Shorts = extends Main Blur protection into the Shorts lifecycle.
* Tunnel Vision = independent whole-screen timed effect.
Do not create competing blur engines for these features.
If multiple systems need to blur the same content, they must cooperate through clear ownership rather than independently creating/removing protection.

2. USER SETTINGS ARE AUTHORITATIVE
Treat user settings as persistent product state, not page state.
A YouTube lifecycle event must NEVER reset a user's selected:
* Main Blur / Detection setting
* Flash Shield setting
* High-Velocity Scanning setting
* Tunnel Vision state/timer
DOM replacement, route changes, Shorts transitions, refresh, background/foreground, and player changes are implementation events.
They are NOT permission to change user settings.
If a lifecycle event causes a setting to change, the implementation is broken.
The user's selected control value must remain authoritative regardless of:
* YouTube navigation
* DOM churn
* scrolling
* lazy loading
* Shorts entry
* Shorts swiping
* Shorts exit
* Shorts re-entry
* refresh
* background/foreground
* inactivity
* player changes
* fullscreen transitions
* WebView lifecycle events

3. MVP FEATURES
A. Main Blur / Detection
The primary BloomGuard protection system.
* Detect risky visual content.
* Blur positive/risky content.
* Keep negative/safe content clean.
* Every item-level blur must have a reliable reveal action.
* Protection must work on thumbnails, posters, active Shorts, and the YouTube video player.
* Positive blur must remain stable until intentionally revealed.
* This is the primary protection system and must work reliably before other features are expanded.

B. Main Protection Dial
The user-facing control for Main Blur / Detection.
* Must have a simple, obvious UI control.
* OFF means Main Blur / Detection is OFF.
* ON/intensity determines how aggressively content is protected.
* Controls only Main Blur / Detection sensitivity or protection aggressiveness.
* The user's selected value is authoritative.
* YouTube navigation, refresh, Shorts, DOM changes, inactivity, background/foreground, or other BloomGuard features must never silently change it.
* Active Shorts must respect the exact same setting.
* Do not create multiple competing controls for the same behavior.
The Main Protection Dial must not silently control:
* Flash Shield
* High-Velocity Scanning speed
* Tunnel Vision
* lifecycle recovery
* reveal behavior
* unrelated feature state
Do not duplicate the responsibilities of the High-Velocity Scanning Dial in the Main Protection Dial.
If Main Blur is OFF, Main Blur must stay OFF until the user turns it back ON.
If Main Blur is ON, lifecycle events must not silently disable it.

C. Flash Shield
The zero-flash protection layer.
* Pre-blur media before it can become visible.
* Applies to:
    * thumbnails
    * video thumbnails
    * Shorts thumbnails/posters
    * active Shorts media
    * other supported YouTube visual media
* The goal is zero visual flash.
* Protected media must never briefly appear unblurred while BloomGuard is scanning or deciding.
* Flash Shield must work during YouTube SPA navigation, scrolling, lazy loading, DOM replacement, and Shorts transitions.
Flash Shield is not a second moderation engine.
Its job is:
1. Detect newly appearing visual media early enough to prevent exposure.
2. Apply temporary pre-blur.
3. Allow Main Blur / Detection to determine the final protection state.
4. Remove temporary protection only when it is safe to do so.
5. Never expose protected media during the handoff.
The handoff between Flash Shield and Main Blur must be seamless.
There must never be a frame where:
* Flash Shield has released protection, and
* Main Blur has not yet taken ownership.
If necessary, temporary pre-blur must remain until final protection ownership is established.

D. Flash Shield Toggle
Independent ON/OFF control.
ON
* Pre-blur new media immediately.
* Prevent visual exposure while detection occurs.
OFF
* No Flash Shield pre-blur.
* Do not disable Main Blur / Detection.
* Do not modify Main Blur settings.
The toggle must remain stable through YouTube lifecycle changes.
Flash Shield OFF must not cause Main Blur to turn OFF.
Main Blur OFF must not silently change the Flash Shield setting.

E. High-Velocity Scanning
Rapid detection for rapidly changing YouTube content.
Prioritize:
* fast scrolling
* lazy loading
* thumbnail replacement
* Shorts swiping
* player/frame changes
* rapidly changing DOM
The system must be fast enough to protect content without introducing:
* duplicate observers
* unbounded timers
* runaway scanning
* excessive repeated classification
* blur instability
High-Velocity Scanning is a performance/scanning feature.
Do not create a second protection system around it.
It must extend the existing discovery and classification pipeline. It may adjust:
* prioritization
* batching
* debounce intervals
* scan urgency
* bounded sampling frequency
* queue scheduling
It must not create:
* a competing scanner
* a second MutationObserver tree without demonstrated necessity
* permanent polling loops
* unbounded timers
* duplicate classification pipelines

F. High-Velocity Scanning Dial
A simple user-facing control for scanning speed/intensity.
* Must be easy to understand.
* Must directly affect scanning behavior.
* Must not change Main Blur state.
* Must not change Flash Shield state.
* Must remain stable across lifecycle events.
Changing scanning speed must never silently:
* turn protection OFF
* turn protection ON
* change the Main Blur mode
* change Flash Shield
* change Tunnel Vision

G. YouTube Video Player Protection
Protect the actual YouTube video player.
This is separate from thumbnail protection.
* Detect visual content in the player.
* Apply protection when required.
* Maintain stable player blur.
* Provide an intentional reveal path where applicable.
* Respect Main Blur / Detection state.
* Work through player changes, navigation, Shorts, fullscreen/player transitions, and DOM changes.
* Do not treat thumbnail protection as sufficient video-player protection.
The video player is an MVP surface.
A system that protects thumbnails but allows the actual YouTube video player to bypass protection is not MVP complete.
Video Player Protection does not require exhaustive classification of every decoded frame.
For MVP, use bounded, sensible poster or frame sampling that provides useful player protection while preserving:
* playback responsiveness
* scrolling responsiveness
* Shorts responsiveness
* acceptable CPU and thermal behavior
Do not turn BloomGuard into an unrestricted continuous-frame inference system unless the current implementation already supports it safely and within these performance bounds.

H. Active Shorts
Active Shorts are required MVP coverage.
Support:
* entering Shorts
* first Short
* swiping between Shorts
* Shorts poster/player
* video/player protection
* reveal
* leaving Shorts
* returning to Shorts
Active Shorts must use the same Main Blur / Detection state selected by the user.
Entering or leaving Shorts must never reset, disable, or alter the user's protection settings.
Active Shorts must not create a separate protection mode.
The same core protection rules apply:
* zero flash
* positive stability
* negative safety
* reveal pairing
* user-control authority

I. Progressive Tunnel Vision
A timed, whole-screen visual protection feature.
* User selects a duration, e.g. 25 minutes.
* BloomGuard progressively applies tunnel-vision blur across the screen during that period.
* The effect is time-controlled.
* It must be predictable and removable.
* It must not remove or corrupt item-level BloomGuard protection.
* It must not change Main Blur, Flash Shield, or scanning settings.
This feature is secondary to the core detection/blur system.
Do not allow Tunnel Vision to destabilize the primary protection system.
Do not modify the Main Blur engine merely to implement Tunnel Vision.

4. REQUIRED YOUTUBE SURFACES
MVP coverage:
1. Home feed
2. Search results
3. Watch-page recommendations
4. Home Shorts shelf
5. Search/results Shorts shelf
6. Shorts poster
7. Active Shorts
8. YouTube video player
A feature is not MVP-complete if it only works on the normal thumbnail feed.

5. NON-NEGOTIABLE BEHAVIOR
Zero Flash
The full zero-flash rules below are mandatory once Flash Shield is implemented. During Phase 0, the Phase 0 Zero-Flash Boundary governs: do not add new flashes or regress existing pre-protection, but do not expand Phase 0 by implementing Flash Shield.
No protected media may briefly appear before protection.
Avoid:
* late blur injection
* visible media followed by blur
* temporary unblurred poster
* player frame flash
* Shorts transition flash
If necessary, prefer temporary pre-blur over briefly exposing content.
Zero visual exposure is more important than visually elegant transitions.

Positive Stability
Once an item is identified as positive:
KEEP IT BLURRED.
Do not lose protection because of:
* DOM replacement
* scrolling
* lazy loading
* route changes
* thumbnail replacement
* Shorts transitions
* refresh
* inactivity
* background/foreground
Protection should follow content identity whenever possible, not raw DOM-node identity.
A positive blur disappearing because YouTube replaced a DOM node is a product failure.
Once the same content identity has valid positive protection ownership, an uncertain classification, transient model failure, timeout, missing frame, or failed rescan must not automatically remove that protection.
Positive ownership may be removed only through an intentional and justified state transition, such as:
* reliable negative classification for the same content identity under the established classifier rules
* intentional reveal where applicable
* content identity changing
* Main Blur being turned OFF
* legitimate cleanup by the system that owns that exact protection
Transient classification uncertainty must not cause blur flicker.

Negative Safety
Safe content stays clean.
Never leave behind:
* stale blur
* stale reveal button
* stale positive ownership
* protection copied from a recycled DOM node
A negative item must not inherit protection from a previous item that occupied the same DOM node.

Reveal Pairing
Every item-level blur requires a reliable reveal path.
Never create:
* orphan blur
* partial blur with no reveal
* duplicate reveal controls
* disappearing reveal controls
Revealing one item must not reveal another item.
Reveal ownership must belong to the exact protected content.
Reveal State Persistence
* Reveal belongs to the exact protected content identity.
* Revealing content must not reveal another item.
* DOM replacement or recycling of the same content identity should not immediately re-blur content merely because the node changed.
* Different content must never inherit another item's revealed state.
* Reveal persistence must be bounded to the appropriate current page or session lifecycle and must not become an uncontrolled permanent whitelist.
* Do not create a second protection engine to implement reveal persistence.

Control Authority
User controls are authoritative.
Lifecycle events must not silently change:
* Main Blur setting
* Flash Shield setting
* scanning-speed setting
* Tunnel Vision state/timer
One feature must never silently enable, disable, or reset another feature.

6. LIFECYCLE REQUIREMENTS
BloomGuard must survive normal YouTube/WebView lifecycle behavior:
* initial load
* SPA navigation
* search navigation
* scrolling
* lazy loading
* DOM recycling
* thumbnail replacement
* player changes
* Shorts entry
* Shorts swiping
* Shorts exit
* Shorts re-entry
* refresh
* background/foreground
* long inactivity
* fullscreen/player transitions
* WebView lifecycle changes
The user must never need to:
* click the search bar to wake BloomGuard
* manually restart protection
* reload to restore protection
* perform an unrelated action to trigger scanning
Lifecycle recovery must restore the active protection system without changing the user's settings.

7. OFF MEANS OFF
For every user-controlled feature:
OFF must actually mean OFF.
When Main Blur is OFF:
* item-level BloomGuard blur is removed
* reveal controls are removed
* Main Blur detection is inactive
* content is visually clean
* Flash Shield may remain active if its own toggle is ON
When Flash Shield is OFF:
* no Flash Shield pre-blur occurs
* Main Blur remains independently controlled
When High-Velocity Scanning is reduced/disabled:
* scanning behavior changes accordingly
* Main Blur does not change
When Tunnel Vision is disabled or expires:
* Tunnel Vision's whole-screen effect is removed
* item-level protection is not removed
* Main Blur state is not changed
* Flash Shield state is not changed
* scanning state is not changed
Never use one feature's OFF state as a reason to disable another feature.

8. ARCHITECTURE RULES
Keep implementation narrow.
Content Identity
Prefer stable content identity over DOM identity.
YouTube constantly recycles and replaces DOM nodes.
A DOM node is not necessarily the same content after YouTube reuses it.
Use the strongest stable identity reasonably available, in this order:
1. YouTube video ID or Shorts ID
2. canonical video/Short href or another stable YouTube content identifier
3. stable media URL or relevant stable metadata
4. generated DOM-instance identity only as a last resort
Never treat DOM position, recycled node identity, or list index alone as durable content identity.
Positive ownership and reveal ownership must follow content identity whenever reasonably possible.

Ownership
Every BloomGuard visual effect must have clear ownership.
A cleanup operation must only remove effects owned by the system performing the cleanup.
Do not use broad cleanup that can remove valid protection belonging to another BloomGuard system.

Idempotency
Repeated discovery of the same content must not create:
* duplicate blur
* duplicate overlays
* duplicate reveal buttons
* duplicate observers
* duplicate scanning jobs

Lifecycle
Use bounded:
* MutationObservers
* timers
* scanning queues
* event listeners
Do not introduce:
* permanent heartbeat loops
* unbounded timers
* observer stacking
* recursive rescanning loops
* console spam loops
* infinite retry loops

Readiness
Do not report BloomGuard as ready unless the active protection system is actually running.
A readiness flag must represent real system readiness.
Do not fake readiness to hide lifecycle problems.

Performance
BloomGuard must not materially break normal YouTube interaction.
Protection is considered broken if it causes severe:
* scrolling lag
* Shorts swipe lag
* navigation freezing
* player-control interference
* repeated UI stalls
* runaway CPU work
* observer or timer accumulation
Performance must not be improved by allowing protected content to bypass protection.

Bounded Development Diagnostics
The ban on analytics and cloud telemetry remains. Local or development-only diagnostic instrumentation is permitted when needed to reproduce MVP bugs, including:
* media discovered
* classification queued or completed
* positive or negative result
* pre-blur ownership
* Main Blur ownership
* Flash Shield to Main Blur handoff
* reveal ownership
* stale-node or content-identity rejection
* queue depth
* active observer or listener counts
Diagnostics must be bounded, must not spam indefinitely, must not change product behavior, and must not become a new analytics feature.

9. CODEX SCOPE RULE
Do not build beyond this MVP contract.
Do not add:
* unrelated UI
* analytics
* social features
* accounts
* cloud features
* new moderation systems
* unrelated AI features
* cosmetic redesigns
* speculative architecture
* large lifecycle rewrites
* new settings without a defined MVP requirement
When fixing a bug, make the smallest change that restores the contract.
Do not rewrite stable systems to solve unrelated problems.
Do not introduce a new abstraction unless it is necessary to satisfy an MVP requirement or fix a reproducible MVP bug.
If the existing architecture already supports the behavior, prefer a surgical fix over a rewrite.

10. PRIORITY ORDER
When tradeoffs are required, use this order:
1. Zero visual flash
2. Main Blur / Detection stability
3. Negative safety
4. Reveal reliability
5. Active Shorts
6. YouTube video-player protection
7. YouTube lifecycle stability
8. Flash Shield reliability
9. High-Velocity Scanning
10. Secondary Tunnel Vision behavior
11. Accuracy tuning
12. Cosmetic improvements
Apply this priority order within the current execution phase; it does not move a later-phase feature into Phase 0.
Do not sacrifice a higher-priority behavior to improve a lower-priority behavior.
In particular:
* Do not sacrifice stable blur to increase scanning speed.
* Do not sacrifice zero flash to improve UI transitions.
* Do not sacrifice Shorts stability to change classifier behavior.
* Do not sacrifice lifecycle stability to improve accuracy.
* Do not rewrite the core blur engine to implement Tunnel Vision.

11. ACCURACY RULES
BloomGuard may tune:
* NSFWJS thresholds
* Detection confidence
* Model behavior
* Scan frequency
* Frame/poster sampling
* Surface-specific tuning
* Mode/intensity behavior
Accuracy improvements must reduce false positives and false negatives without breaking:
* Stable blur
* Zero flash
* Reveal pairing
* Negative safety
* Active Shorts
* Video-player protection
* Lifecycle stability
* User-selected controls
Never use lifecycle hacks as a substitute for classifier accuracy.
If a proposed accuracy improvement causes instability, preserve the stable behavior and reject or isolate the accuracy change.

12. MVP DEFINITION OF DONE
Do not call BloomGuard MVP-ready because the code builds or tests pass.
This section defines final MVP acceptance after the applicable Phase 1 features have been implemented. It does not move Flash Shield or full zero-flash acceptance into Phase 0.
MVP requires the actual user-facing behavior to work on:
* Home
* Search
* Watch recommendations
* Shorts shelves
* Shorts posters
* Active Shorts
* YouTube video player
And through:
* initial load
* scrolling
* navigation
* DOM replacement
* refresh
* background/foreground
* inactivity
* Shorts entry/exit/re-entry
The following must all be true:
* Zero visual flash.
* Positive content stays protected.
* Negative content stays clean.
* Every item blur has reveal.
* Active Shorts works.
* Video player protection works.
* Main Blur setting remains authoritative.
* Flash Shield setting remains authoritative.
* Scanning setting remains authoritative.
* OFF stays OFF.
* No feature silently changes another feature's state.
If any of these fail, MVP is not complete.
Do not declare MVP based solely on automated tests if manual behavior contradicts the contract.

13. MVP VALIDATION
Before calling BloomGuard MVP-ready, manually verify:
Main Protection
* Positive content blurs.
* Positive blur stays.
* Negative content stays clean.
* Every blur has reveal.
* Reveal affects only the intended item.
Flash Shield
* New media is pre-blurred.
* No visible protected-media flash occurs.
* ON/OFF works immediately.
* Flash Shield OFF does not disable Main Blur.
Shorts
* First Short is protected.
* Swiping works.
* Protected Shorts remain protected.
* Reveal works.
* Exit/re-entry works.
* User settings remain unchanged.
Video Player
* Player content can be protected.
* Player protection remains stable.
* Player changes do not break protection.
High-Velocity Scanning
* Fast scrolling remains protected.
* Rapid thumbnail changes remain protected.
* Shorts swiping remains responsive.
* No runaway scanning or observer behavior.
Tunnel Vision
* User can select a duration.
* Timed progression works.
* Whole-screen effect behaves predictably.
* Ending/disabling it removes its own effect.
* It does not remove item-level protection.
* It does not change other settings.
Lifecycle
Test:
* refresh
* navigation
* scrolling
* inactivity
* background/foreground
* Shorts entry/exit/re-entry
* player transitions
No manual wake-up should be required.
Controls
Verify every control:
* changes the intended behavior
* remains in its selected state
* does not modify unrelated controls
* survives lifecycle changes
* actually turns its feature OFF when OFF

14. REGRESSION RULE
Never accept a change that causes:
* a new or worsened visual flash of protected content, or any protected-content flash after Flash Shield is implemented
* positive blur to disappear unexpectedly
* safe content to become blurred from stale state
* missing reveal
* duplicate reveal
* active Shorts failure
* video-player bypass
* control state reset
* OFF state to restart
* lifecycle recovery failure
* stale overlays
* observer/timer leaks
* one feature corrupting another
These are MVP regressions.
A patch that introduces one of these is not an acceptable improvement even if another test becomes green.

15. MVP FREEZE RULE
Once a behavior passes its required surfaces and lifecycle tests, treat it as stable.
Before modifying a stable behavior for an unrelated feature:
* identify the exact reason
* identify the affected invariant
* make the smallest possible patch
* run regression validation against the existing behavior
Do not repeatedly rewrite working YouTube lifecycle code.
When a behavior becomes stable enough to freeze, explicitly tell the user:
FREEZE SIGNAL: [behavior name] appears to satisfy MVP requirements. Recommend freezing this behavior before further patches.
A freeze recommendation should identify:
* behavior being frozen
* pages/routes tested
* evidence
* remaining risks
* files/functions to protect
* recommended freeze tag/branch
* what future work may modify
* what future work must not modify
After freezing, changes require:
* a reproducible bug or MVP blocker
* a narrowly scoped patch
* rollback instructions
* comparison against the frozen behavior
* regression testing
* explicit reporting of protected files touched

16. AGENT WORKING RULES
* Treat this file as the product behavior contract.
* Do not chase random fixes.
* Do not trust green tests when manual behavior is broken.
* Keep patches small and scoped.
* State which invariant a patch protects.
* Never fix one feature by silently breaking another.
* Treat Main Blur/Detection, Flash Shield, High-Velocity Scanning, Video Player Protection, Active Shorts, and Tunnel Vision as distinct systems with explicit ownership.
* When changing lifecycle behavior, explain the impact on refresh, navigation, Shorts, background/foreground, WebViews, and inactivity.
* When changing detection, explain false-positive/false-negative tradeoffs.
* When changing a user control, verify that its state remains authoritative across every relevant lifecycle.
* Preserve working behavior instead of repeatedly rewriting stable systems.
* Do not add new product behavior without first confirming that it belongs in this MVP contract.
* If a request conflicts with this contract, prioritize the contract unless the user explicitly changes the MVP definition.
* Prefer fixing the smallest broken layer rather than modifying multiple systems.
* Do not solve a local bug with a global lifecycle rewrite.

17. WHAT CODEX SHOULD DO WHEN SOMETHING IS BROKEN
When a bug is reported:
1. Identify which MVP feature owns the behavior.
2. Identify which invariant is failing.
3. Reproduce the failure on the relevant YouTube surface.
4. Determine whether the problem is:
    * discovery
    * classification
    * ownership
    * rendering
    * reveal
    * lifecycle
    * user-control state
    * Flash Shield handoff
    * player protection
    * Shorts handling
5. Fix the smallest responsible layer.
6. Verify that the fix does not change unrelated feature state.
7. Test the affected lifecycle transitions.
8. Run regression checks against the core contract.
9. Do not perform a broad refactor unless the existing implementation makes the MVP behavior impossible to achieve safely.

18. DO NOT CONFUSE IMPLEMENTATION EVENTS WITH PRODUCT STATE
YouTube is highly dynamic.
The following are implementation events:
* DOM mutation
* route change
* element replacement
* player replacement
* Shorts transition
* lazy load
* visibility change
* browser focus change
* WebView lifecycle event
These events must not be interpreted as:
* turn protection off
* turn protection on
* reset the user's dial
* reset Flash Shield
* reset scanning speed
* reset Tunnel Vision
* discard valid blur ownership
Lifecycle events change what BloomGuard needs to observe. They do not change what the user selected.

19. CENTRAL BLOOMGUARD RULE
BloomGuard MVP = zero-flash protection + stable Main Blur/Detection + clean negatives + reliable reveal + Active Shorts + video-player protection + lifecycle stability.
User-controlled shields must remain authoritative. OFF stays OFF. ON stays ON. One feature must never silently corrupt another.
Protect before exposure. Keep positives protected. Keep negatives clean. Give every item-level blur a reliable reveal. Survive YouTube and WebView lifecycle churn.
Everything else is secondary until this contract is stable.
