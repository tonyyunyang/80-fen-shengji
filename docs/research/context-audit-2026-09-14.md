# AI context audit · 14 September 2026

The rule engine and existing bilingual guide already kept the earlier equal
play as winner. This audit adds explicit examples and per-action tie facts;
it does not change the game rule or substitute a different model action.

| Decision information | Result |
| --- | --- |
| Identical suit/rank, jokers and tied level cards | Earlier equal wins. Physical ID magnitude is irrelevant. New facts identify legal moves tying the current winner. A trump ruff remains a different comparison. |
| Partner, opponents, dealer, level and trump | Already supplied explicitly, along with score thresholds and active rule settings. |
| Accepted declarations and overcalls | Already retained chronologically, with exposed cards and later public locations. Passes/private bid timing are not evidence. |
| Following suit, pairs, tractors, throws | Authoritative obligations and the complete legal menu remain. Large menus use all held IDs, never a truncated shortlist. |
| Current winner and players still to act | Already available, with conservative counters and separately labelled uniform-reference risks. A current winner is not automatically secured. |
| Public play history | Previously included the current trick, which was repeated in `trick`. v23/v24 supplies completed tricks only in `history`; `trick` is separate. Notebook deductions were already deduplicated. |
| Points and the kitty | `attackPoints` excludes the current trick and unsettled kitty. New bounds use only the public deck inventory minus own/public cards; invalid/incomplete inventory yields null. Known burial remains private to the burier. A closing final action includes kitty multiplication and a final win/loss only when bounds prove it. |
| Team plan and structural cost | Existing feed, support, entry, void, pair/tractor and last-trick guidance remains. No strategy or ownership guess becomes a fact. |

Normal card decisions use `expert-audit-zh/en` (v23), or
`expert-audit-search-zh/en` (v24) with optional Node analysis. Earlier profiles
remain unchanged for comparison. Declarations, redeal and burial retain
v16/v17. Cloudflare keeps Node analysis disabled. Both languages use identical
JSON facts and action schemas; the 12-second deadline is unchanged.

Kitty bounds deliberately ignore strategic burial and additional ownership
constraints, so they are conservative, not a midpoint or a probability. When
all other cards have become public or belong to the acting hand, the eight
remaining cards determine the kitty's point total by elimination. Only the
point bounds and their basis are added, never hidden engine cards.

Offline regressions check both physical-ID orders, equal side/level/joker
singles, equal off-level pairs, ruffs and nonmatching structures. Complete
deals check the true kitty score stays within every public bound and that the
closing action's accounting matches the rule engine. Provider tests check
language parity, unchanged legal tools, distinct histories and hidden-state
independence. These establish rule/context correctness, not a measured
increase in model playing strength.
