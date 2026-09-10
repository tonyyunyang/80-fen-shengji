# AI evaluation: methods and current evidence

[Current AI behavior](../ai.md) · [Player protocol](../player-protocol.md)

The target is **partnership wins**, with score/level outcome second. Agreement with the local practice bot is not a success metric. A legal response is not necessarily a strategically good move.

## Evaluation design

Card-play pilots use identical hands, trump and burial within a seed. Two model partners face the preserved practice policy, then swap teams. That isolates the card-play comparison; it does not evaluate model declarations or burial. Full continuous-dealing games are checked separately.

Keep genuine API actions, forced actions, simulated actions and fallback separate. Use new seeds after development, retain incomplete games and failed attempts, and account for shared seed clusters when interpreting uncertainty. A model must receive only its own observation. Do not publish private checkpoints or raw provider logs.

## September 2026 findings

These are small development samples, not a league ranking or proof of general strength.

| Comparison | Observed result | Practical reading |
| --- | --- | --- |
| Chinese vs English system prose | Both languages lost the two games in each of two matched model/context studies; Chinese had a better score margin in those samples. | No demonstrated win-rate advantage for Chinese. The default follows the game's language, and each seat can choose English. |
| Factual rows vs earlier guidance | On one Qwen Max pair, both won 1/2; factual rows improved mean margin. A Flash pair did not improve. | More readable facts are not automatically stronger strategy. |
| Eight-sample endgame analysis | Across two matched Qwen Max seed clusters, factual-only won 1/4 and analysis won 2/4, without fallback. | A promising but small signal. The fresh confirmation seed had equal win counts. |
| Full Qwen Max games with analysis | 1/2, with 61 valid requests and no fallback. These included live declarations and a model burial. | Integration evidence, not a frozen-deal comparison. |
| Fresh Flash game pair with analysis | 1/2 without fallback. | No same-seed Flash baseline for this pair. |
| 128-token thinking budget | Qwen Max stayed at 0/2, as did its fast baseline. | More output and latency did not improve wins; not enabled by default. |
| 32-sample analysis | Same 1/2 win count as eight samples on the checked seed, with worse mean margin. | Runtime retains the smaller, bounded analysis. |
| Kimi native tools vs strict JSON | Native-tool attempts stopped incomplete. Strict JSON completed two games with 60/60 legal responses, no repairs and no fallback; both games were lost. | Better protocol reliability, not demonstrated playing strength. |

**Professional-level play and stable superiority over the practice bot are not established.** In particular, do not pool favorable results from different models, versions and seeds into a claim about the default player.

## Current experiment

`expert-facts-zh/en` (v16) joins point destinations and structural facts without recommending a practice-bot move. `expert-search-zh/en` (v17) adds up to eight hypothetical allocations from twelve cards remaining. Allocations satisfy public declarations, known burial, card conservation, proven voids and historical following constraints.

Every candidate uses the same hypotheses. Simulated continuations use the preserved fast practice rollout on each simulated seat's own observation. Those forecasts are approximate: they are neither actual hidden hands nor calibrated win probabilities. The full legal action space remains available.

The worker inherits no credentials, allows at most one active job, and has a 1.2-second local budget. Busy or unavailable analysis is omitted. The full model decision, including this work and repairs, still shares 12 seconds. The 32-sample v18 variant is evaluator-only. Earlier context profiles remain for reproducible comparisons, not as alternate game interfaces.

## Running a study

The [paired evaluator](../../scripts/paired-eval.mjs) exports `runEvaluation`. Set `contextProfiles` explicitly when studying a current variant. The CLI without `--live` only checks the harness; its default comparison is historical. Paid execution requires `--live` and your own locally configured credential. The evaluator enforces request, wall-time, output and error limits; default ceilings are 200 attempts and 30 minutes per pilot.

Run routine tests first:

```sh
npm test
npm run check
node scripts/paired-eval.mjs
```

Before a live study, define the model, context versions, seeds, phases, request ceiling and time ceiling. Preserve actual metering when available; unknown usage and prices remain unknown. Results should explain aborted games and fallback, not quietly exclude them.

## Strategy sources

The independent prompt guide distills conditional ideas about entries, purposeful trump leads, point feeding, burial and final-trick control. Sources include [Game Tea's dealer guide](https://wap.5158wan.com/news/201112/2704.html), its [partner guide](https://wap.5158wan.com/news/201112/2703.html), and [original Lianzhong discussion](https://bbs.lianzhong.com/showtopic-4172049-2.aspx). Their regional prescriptions and informal signals are not imported as rules. The project's deterministic [rules](../rules.md) remain authoritative.

Useful next work includes whole-deal planning, avoidable point losses, throw failures and more opponent policies. Prefer controlled outcome evidence to longer prompts or repeated favorable seeds.
