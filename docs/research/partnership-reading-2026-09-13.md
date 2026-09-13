# Declaration memory, point-cashing windows and selection feel

[AI evaluation](ai-evaluation.md) · [Synthetic positions](../../test/fixtures/partnership-read-cases.mjs) · [Interaction contract](../table-experience.md)

## What the strategy research contributed

The [Bianfeng discussion of point disposal and control](https://www.gameabc.com/news/201704/3372.html) distinguishes cashing vulnerable short-suit points from preserving entries and establishing length. This supports comparing the whole holding rather than always giving the cheapest card or the highest point card.

The [Game Tea partner guide](https://wap.5158wan.com/news/201112/2703.html) discusses creating opportunities, transferring the lead and the cost of repeatedly forcing a void partner to trump. The [attacker guide](https://wap.5158wan.com/news/201112/2702.html) supplies a complementary attacking perspective. These are conditional ideas, not universal rules: a confident side winner can instead let a void partner discard points safely.

The original author's [Lianzhong card-memory discussion](https://bbs.lianzhong.com/showtopic-4173446-8.aspx) emphasizes suit counts, missing ranks and the cards needed to establish a structure. The implementation records those public facts. Informal signal conventions and absolute prescriptions from these sources are not imported as facts about the current players. A bid proves its exposed cards; it does not prove a long suit, and failure to bid does not prove missing cards.

## Implementation

v21/v22 adds a chronological declaration ledger, including earlier overcalls and whether each exposed card was played, remains in a revealing nondealer's hand, belongs to the acting player, or may be in the dealer's kitty. The existing accepted-declaration events are retained in compressed completed replays; an explicit regression verifies this through an overcall and next-deal reset. The on-screen history now shows the actual cards and single/pair strength.

Exact v19 counter deductions remain intact. Separately, a bounded combinatorial reference estimates following and counter possibilities using only the acting observation. It treats each seat's allowed unknown pool uniformly, conditions on its size and fixed revealed cards, and uses a union bound for matching pairs/tractors. A reference risk at most 0.04 can identify a point-feed window. This is a heuristic under a stated allocation assumption, not a calibrated posterior or a guarantee: strategic burial, previous choice bias and joint allocation weights are omitted. Insufficient public history or incomplete structure enumeration suppresses the estimate.

The model is encouraged to cash points while opponents are likely to follow below a teammate, including expendable weak pairs. Public suit histories and own structures support entry/length planning. The guide explicitly counters over-aggression when an opponent is proven void or the trick has no points, while retaining the exception for a guaranteed 80-point win. No model action is silently replaced and no legal menu is pruned. The preserved practice/fallback policy is unchanged.

## Bounded live evaluation

Both stages used Qwen 3.8 Max, non-thinking, 512 output tokens, twelve-second decisions and explicit error/request/time guards. All cases were synthetic; no user replay or private opponent hand was sent.

The initial stage was capped at 240 requests/25 minutes and used **239**. It compared v19 against the v21 prototype, then checked the corrected prompt. The additional final-version pilot was separately capped at 160 requests/20 minutes and used **99**. Total: **338 genuine API requests**, no invalid actions, repairs, timeouts or fallback in these runs. Raw reports and credentials remain private.

| Tactical run | v19 | Reading candidate |
| --- | --- | --- |
| Eight new positions, each rotated (16 decisions) | 8/16 | Prototype 15/16 |
| Previous regression suite (24 decisions) | 24/24 | Prototype 22/24 |
| After explicit risk reminders: all 16 new positions plus eight legacy controls | 15/24 | Final 24/24 |

The initial failures included feeding a proven void and covering a zero-point trick too expensively. The correction makes those exceptions explicit next to the action tool. The final confirmation reused development positions; its perfect score is not a held-out success rate. The old baseline also varied between runs.

| Paired pilot | v19 wins | Candidate wins | Change in mean score margin |
| --- | --- | --- | --- |
| Seed 903137, initial prototype | 1/2 | 1/2 | −12.5 points |
| Fresh seed 903149, final risk reminders | 0/2 | 1/2 | +5 points |

Each pilot froze hands, trump and burial, then swapped the model partnership against the preserved practice policy. All eight games completed. In the final pilot, the candidate's attacking game scored less than the baseline (40 versus 65); its defensive game improved (75 versus 110 conceded), producing one win instead of none. The initial negative pilot remains part of the record. These single-seed results do not establish stable overall strength or a long-term win-rate improvement, and are not pooled across prototype versions.

## Selection interaction

The locally installed [Balatro](https://www.playbalatro.com/) was inspected read-only for the separation of highlight, hover and drag states. No original game code or assets were copied into the repository. This implementation uses its own critically damped selection transition and retains the existing fixed-slot picking architecture.

Selected cards now keep a fixed height without hover tilt or idle bob. The exposed raised strip accepts a click directly. Returning a selected drag group resolves the responsive lift function correctly; previously it could produce a non-finite target. Mouse sweeps measured zero selected-height variation after settling. Chromium checks also covered group return, reduced motion, keyboard selection, 33-card hands, portrait/landscape phone sizes, native horizontal touch scrolling, upward play, restart and a clean console. These are browser viewport/input checks, not physical-device benchmarks.
