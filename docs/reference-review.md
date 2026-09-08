# Reference review

Initial review on 2026-09-07 used source and documentation inspection only. The implementation update below records the subsequent extraction and tests; the original review findings remain useful as provenance.

## Implementation update — 2026-09-08

The isolated port is now implemented: `vendor/peilian/reference-core.cjs` preserves the first source script block unchanged, with the original license and checksums. `src/peilian.js` wraps it; the independently written engine does not import it. Tests verify identical card decisions on fixed lead/follow/bury observations and legal full-deal operation. Browser probabilities are adapted with independent reproducible decision randomness and the new seat-independent schedule. Comparative model strength requires a separate, bounded evaluation.

Repository: [ChannonTian/80fen](https://github.com/ChannonTian/80fen). Pinned commit: [`96f69258b68495904f360a199738b161da4f4998`](https://github.com/ChannonTian/80fen/commit/96f69258b68495904f360a199738b161da4f4998). The README and main game's version tag identify v0.7.14. The repository includes an [Apache 2.0 license](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/LICENSE).

## What is verified

| Finding | Evidence | Consequence for this project |
| --- | --- | --- |
| The main product is a static Shanghai-rules game with a heuristic AI and coaching features | [README](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/README.md) and [index.html](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/index.html) | A useful reference for behavior, rules, and training ideas; its feature set is not automatically our scope |
| The competition entry point expects JavaScript decision policies with five callbacks, operating without network access | [Submission example](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/public/example/index.js) and [participant contract](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/public/README.md) | This supports the user's distinction between AI-written policies and live API players |
| The baseline wraps internal AI functions from a selected HTML build | [ai-baseline.js](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/ai-baseline.js), [baseline.js](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/baseline.js), and [engine.js](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/engine.js) | Copying the small wrapper alone does not preserve 陪练 |
| The tournament baseline changes some product behavior: declaration randomness, redeal choice, and information passed to the burying strategy | [baseline.js](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/baseline.js) | Choose which behavior to preserve and version it explicitly |
| The referee supplies a seat's hand and public history, with buried cards supplied only to the dealer; returned card IDs are resolved against the real hand | [referee.js](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/referee.js) | Useful precedent for an authoritative engine and separate player views; this inspection is not a proof of complete isolation |
| Bidding is queried after each of 100 dealt cards, then through closing bidding passes | [Participant contract, onDeal](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/contest/public/README.md#3-五个方法) and referee dealing loop | A direct callback-to-API translation would create many requests before card play |

The five callbacks cover declaration during dealing, a redeal decision, burying the kitty, leading, and following. Our asynchronous player protocol must cover the phases we adopt, including recovery from network failures.

## Rules requiring an explicit choice

The reference describes four players, two decks with 108 individually identified cards, 25 cards per hand, and an eight-card kitty. Its Shanghai rules include configurable partial-tractor following, redeal thresholds, mandatory levels, and progression behavior. This implemented Shanghai profile is the rule reference. See the [rules and implementation specification](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/docs/RULES.md).

Two details especially affect our design. A deal finishes when the hands are exhausted; multi-card plays mean it need not contain 25 tricks. Also, an unsuccessful 甩牌 attempt is an adjudicated game outcome in this ruleset, distinct from a malformed action. A pre-action helper must not reveal whether hidden opposing hands can defeat a throw. The accepted rules must specify what becomes public after adjudication.

The source includes rules vectors, AI scenario tests, paired comparisons, and replay-related tools. Those are useful approaches to learn from. Their presence does not establish that our independent implementation is correct or that published measurements apply to it. Establish our own reviewed examples and investigate any disagreement with the reference.

## Recommended preservation approach

Status: this recommendation was selected during implementation. The confirmed requirement is current or similar behavior, so identical output on every possible state is not a product promise.

**Recommend an isolated port of the existing browser bot first.** Keep its strategy implementation, weights, and necessary helper dependencies at a pinned version; connect it to our player interface with a small adapter. This gives us a stable practice opponent and comparison baseline while we build the new engine, UI, and API players. We can replace strategy internals later when a specific benefit justifies it.

| Approach | Benefit | Cost or uncertainty |
| --- | --- | --- |
| Port the existing bot behind an adapter | Preserves more of the accumulated tuning and gives us a concrete behavior reference | Requires dependency extraction and compatibility checks; carries a versioned third-party component |
| Reimplement the strategy ideas immediately | Full control over the implementation and its fit with our engine | Recreates many interacting choices; a plausible implementation may play differently, making integration bugs harder to distinguish from strategy changes |

The source gives this recommendation a plausible boundary: the first script block separates engine/AI code from the browser controller, with policy functions calling rule helpers. Its exports include memory/inference, scoring, and endgame-search functions. Some declaration and redeal probabilities live in the controller. See the [source exports](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/index.html#L3924-L3937), [controller decisions](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/index.html#L5303-L5397), and [design map](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/docs/DESIGN.md#b-代码地图). Extraction has not been executed or proven complete.

### Proposed component boundary

- Keep a traceable, unchanged reference snapshot for comparison, including its version and original attribution/license material. Application packaging should contain only the bot and the dependencies actually needed.
- Translate our seat observation into the bot's expected input, and translate its proposed cards back into our action format. The bot receives only information available to that seat.
- Initially retain required reference rule helpers privately inside the bot component. Our new engine remains the sole authority for accepting actions, changing state, and scoring. Compare helper behavior with our agreed rules; surface any disagreement rather than masking it with a fallback.
- Preserve strategic scoring, weights, and relevant declaration/redeal randomness. Use reproducible random inputs independent of the secret shuffle seed; comparing matching random draws is distinct from exposing the original game's seed to a player.
- The new controller owns timing and configurable seats. Original assumptions such as a fixed human seat and browser countdowns are not part of the preservation target. Any changes to strategic decision opportunities or rule interpretation must be explicit.
- Select one version initially. Evaluate later upstream updates as deliberate changes rather than automatically absorbing them.

### How we would verify it

Before adapting behavior, capture representative original decisions for declaration, burying, leading, following, and eligible redeals. Record the observation, rules/settings, relevant random inputs, and returned action. These are **characterization tests**: they record what existing software does, including behavior we may later choose to change.

Compare the port on the same fixtures, accounting for card-ID translation and documented seat/timing changes. Test legality independently against our new engine and run complete deals to catch interaction problems. For rule changes, document expected divergence rather than demanding parity with an obsolete rule. If we later rewrite a heuristic, keep the pinned baseline available and evaluate both the changed decisions and playing results on paired deals.

The learning principle is to preserve an observable baseline before changing implementation or strategy. The API players can then be evaluated against a stable opponent without bundling a speculative heuristic rewrite into the same milestone.

The new engine, UI, and API orchestration are independently implemented. The reference source imported after discovery is isolated in the documented vendor component.
