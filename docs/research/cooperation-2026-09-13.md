# Partnership cooperation: September 13, 2026

[Evaluation method](ai-evaluation.md) · [Synthetic tactical cases](../../test/fixtures/cooperation-cases.mjs)

The change addresses missed safe point feeds and unnecessary use of control cards while a teammate is winning. It supplies conservative possible-counter facts, resource comparisons and an explicit exception for actions that guarantee the attacking team reaches 80. The model still chooses the action; the practice/fallback policy is unchanged.

## Design and limits

Qwen 3.8 Max, non-thinking, 512 output tokens, twelve-second decisions. The study was capped at 240 requests and 25 minutes; **217 requests** were actually made. Credentials and raw reports remain private and are not part of this repository.

The tactical suite has twelve synthetic observations, each rotated by two seats. Acceptable actions were specified before inference, separately from the recommendation scorer. They test safe five/ten/pair feeds, retaining controls, zero-point support, ruff risk, cheaper takeovers and the 80-point exception. They are partial tactical observations, not conserved whole-deal replays. Unknown earlier cards remain unlocated. Both profiles see the same observations, with profile order alternated per case. There are no retries or fallback in this score.

| Tactical run | Old factual context v16 | Cooperation candidate |
| --- | --- | --- |
| Initial prototype, 24 positions each | 16/24 | 22/24 |
| Full-suite repeat after the 80-point prompt correction | 16/24 | 24/24 |

All 96 tactical responses were legal, with no timeouts. Initially both profiles missed the two rotated positions where covering a provisional teammate guarantees 80 points. The correction makes that proven win explicit beside the action contract. The repeat uses the same development positions; **24/24 is not a held-out success rate or a general win-rate estimate**.

## Paired card-play pilot

Before the final 80-point prompt correction, the initial prototype also played a fresh seed, `902713`, against the preserved practice policy. Each profile controlled two partners and then swapped teams. All four games used identical initial hands, trump and burial; declarations and burial were frozen by the fixture.

| Profile | Defending: final attacker score | Attacking: final attacker score | Wins | Mean score margin |
| --- | --- | --- | --- | --- |
| v16 factual baseline | 125 | 90 | 1/2 | −17.5 |
| Initial cooperation prototype | 80 | 95 | 1/2 | +7.5 |

Exactly 80 is an attacker win, so the candidate's defensive game was still a loss. Mean margin improved by 25 points in this one seed cluster; win counts did not improve. The pilot used 121 genuine API actions, zero repairs, zero fallback and zero incomplete games. Forced actions and practice opponents were tracked separately.

The final prompt correction has targeted tactical confirmation, not a second complete paired pilot. Neither this single seed nor the repeated tactical suite establishes stable superiority over the practice bot. Whole-deal planning, lead selection and varied opponents still need broader controlled evaluation.

## Runtime safeguards

The model receives only its own observation. Publicly possible counters are not claimed to be real holdings. Ambiguous dealer declarations, ruff risk and incomplete structural enumeration retain uncertainty. Offline tests check hidden-state invariance, unchanged legal menus, singles/pairs/tractors and every legal last-seat reply for checked secured/lost deductions in seeded deals. The native Cloudflare test exercises both lead and follow requests with v19 facts, no Node worker analysis and no live model calls.

The initial study source is identified by SHA-256 `src/cooperation-context.js`: `d60a194e4a856b134f4fed8462d529226dc3cb8d92f0023bcc912ff0ae3d837c`. The final context and request-building code are retained in this release; future studies should identify their exact commit as well as the context version.
