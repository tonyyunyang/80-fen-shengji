# Optional AI seats

[中文说明](../README.md#把自己的-ai-请上桌) · [Player guide](guide.en.md) · [Protocol](player-protocol.md)

You can play the whole game for free with the local practice bots. External models are an optional way to experiment with partnership card play, not a requirement or a strength guarantee.

## Connect a service

1. Open **New game → API connections**, or the Add connection button beside a seat.
2. Choose Chat Completions, Responses or Messages and enter the service's base URL and your own key.
3. Read its model list. If it has no listing endpoint, enter model IDs manually.
4. Save the connection, then assign a model to each API seat.

Discovery reads `/models`; it does not make a completion or prove that every listed model can play. Prices appear only when the service explicitly provides them. Unknown pricing stays unknown.

Known Kimi Code models on its documented Chat Completions endpoint use strict JSON action objects in fast mode. Kimi documents this non-thinking route as K2.6 even when an alias is returned. The UI explains the route. Other supported requests use their native structured tools.

## What a model sees

Only its own hand and permitted public information: current trump, team identities, attack/defense, hand counts, declarations, play history, proven voids and legal action constraints. The acting dealer can see its own buried cards. No actual other hands, shuffle seed, unknown kitty or quiz answer is included.

The default guide is Chinese; English is available per seat. Both use corresponding system prose with the same facts and action schema. The target is team wins, then score/level outcome—not matching the practice bot's move.

Current normal play uses independent factual guidance plus **experimental endgame analysis**, which can be disabled per seat. From twelve cards remaining, it may compare eight plausible hidden allocations consistent with public evidence. These are uncertain forecasts, not real hidden hands or calibrated win probabilities. A bounded worker keeps this work off the dealing clock.

## Cost and failures

The model returns an action, not an essay. A unique legal move skips inference. The default allowance is 100 real request attempts per table, with a 512-token output cap. One shared deadline of at most 12 seconds covers analysis, the model request and at most one repair.

Invalid or late responses use the preserved local practice strategy. Real API actions, forced moves, simulated actions and fallback remain distinct in accounting. Unreported tokens and prices are not treated as zero or invented charges.

Keys stay only in the owning browser session's server memory, clearing on server restart or expiry. The web process does not load CLI credentials from `.env`. Use a server you trust; see [security and deployment](security-and-deployment.md).

## Research

[Evaluation results](research/ai-evaluation.md) explain the small samples and limitations. Contributors should compare team outcomes on controlled deals, include new unseen seeds and full-deal runs, and report fallback separately. Paid experiments are explicit, bounded and outside routine CI.
