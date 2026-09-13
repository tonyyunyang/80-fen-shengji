# Player protocol v3

Status: implemented. Contracts are updated alongside their implementation. Source of truth for wire fields: `src/game.js`, `src/providers.js`, `server/session.js`.

Continuous dealing is implemented for zero or one human. Shared-device multi-human games retain the ordered handoff mode. API card play uses bilingual cooperation context v19, or v20 with optional Node analysis; declarations, redeal choices and burial retain v16/v17. Chinese is the default, and English is selectable per seat. Legacy advice flags no longer affect normal play. The action protocol retains concurrent declaration bindings and private live-deal accounting. Context versions below describe retained evaluation profiles as well as current play.

## Decision and action

The runner assigns an ID scoped to a unique game plus a monotonically increasing decision number. An action envelope contains `decisionId`, `version`, `seat`, and `action`. The engine rejects a stale ID/version, wrong seat, invalid phase, duplicate card ID, card not held, or illegal following obligation before changing state. Evaluation happens on a copy; accepted transitions return the new state.

| Phase | Game action | Model tool arguments |
| --- | --- | --- |
| Declaration | `{type:"declare",choice:"pass"}` or a supplied option ID | `declare_trump({choice})` |
| Eligible redeal | `{type:"rebel",accept:true/false}` | `request_redeal({accept})` |
| Burying | `{type:"bury",cardIds:[...]}`, exactly eight | `bury_cards({card_ids:[...]})` |
| Lead, or follow without a complete menu | `{type:"play",cardIds:[...]}` | `play_cards({card_ids:[...]})` |
| Follow with a complete menu | `{type:"play",cardIds:[...]}` | `play_move({move_id})`, mapped locally to physical IDs |

Physical IDs distinguish both copies of a face. A legal throw may return an adjudicated smaller play; this is an accepted rules outcome, not an invalid model response. Game/seat/version metadata is bound by the runner and is not delegated to the model.

## Observation

A player sees its hand, public hand sizes, trump/level/dealer/team context, declarations, current trick and ordered play history, public scores, and the kitty only if that player buried it. A declaration request has the current partial hand and legal options. No player receives the shuffle seed, future cards, or other hands. In-game quizzes remain separate from model context.

Provider requests use a self-contained JSON observation with a stable rules prompt. The engine computes following obligations locally. When exhaustive follow enumeration requires at most 20,000 combinations and produces at most 48 legal moves, the observation includes every legal card combination in `legalMoves`. The model chooses its integer ID using `play_move`; IDs are scoped to that request and decoded against that same list. A unique legal follow is applied locally and recorded as forced. Larger searches or menus use direct card IDs and authoritative follow obligations. No partial or strategy-ranked list is presented as complete.

In continuous mode, a separate clock draws one card every 250ms by default (500ms and 700ms remain available). All seats may bid from already received cards; silence does not block another draw. The human action body is `{seat, bidContext, action:{type:"declare",choice}}`. `bidContext` carries game ID, deal epoch and hand count. The engine rejects a context from another deal or a card requirement beyond that received prefix. API jobs additionally retain and validate the originally offered menu. A later equal/stronger opposing bid silently supersedes a weaker proposal; there is no automatic pair upgrade, repair request, or fallback bid for losing that race.

At most one API bid request runs per seat. New cards/public declarations are coalesced into the latest review after a two-second minimum start interval. Eligible seats receive one final review for each full-hand/declaration/closing context, including after earlier passes. Ineligible seats receive none. Countdown ticks do not create new reviews. Closing begins after card 100 and lasts five seconds, renewed only by accepted bids. A closing cutoff limits pending jobs, with a 100ms local fallback margin, while their original 12-second decision cap never moves. Bids at/after the cutoff are too late. See [continuous dealing](continuous-dealing.md).

The historical ordered mode still binds each declaration to a sequential pending decision. It is retained for old fixtures/checkpoints and shared-screen multi-human handoffs. No paid acknowledgement is sent after a draw or successful move; the next observation supplies current state.

## Fair card notebook (compact observation v3)

`notebook` is computed by `src/notebook.js` solely from the supplied seat observation. Before trump is settled it is null. Once settled it provides both-copy joker counts, effective-suit counts, highest possible unplayed and outside-hand faces (including ties), unlocated face counts, the acting hand’s pairs/tractors, proved suit voids with public trick evidence, per-seat public lead/win/point histories, and the current trick’s leading seat/points/remaining seats. Current plays are deduplicated against history. A remaining face is a possibility; unlocated cards include other hands **and the unknown kitty**. No hidden ownership or win probability is inferred. Only the dealer’s known burial can be excluded.

The stable strategy prompt asks for brief tactical comparison: team goal, partner currently winning, players still to act, exposed points, trump control, preserving pairs/tractors and the final trick. It does not reveal private state or include quiz answers. The complete legal menu remains complete and unranked. Output contains only the action, using the native tool or the documented Kimi JSON route; the shared 12-second deadline is unchanged. Normal lead/follow requests use `expert-cooperate-zh/en` (v19), or `expert-cooperate-search-zh/en` (v20) with analysis enabled. Other phases retain `expert-facts-zh/en` (v16) or `expert-search-zh/en` (v17). Earlier profiles remain evaluator options. Request metadata records the actual context version for every attempt.

## Partnership cooperation (v19/v20)

`cooperation` is built solely from the acting observation. It lists recent public leads, proven voids, turn order and conservative possible counters. Possible holdings exclude the acting hand, played cards, known burial and cards publicly assigned to other players. A dealer's unplayed declaration can still be in the kitty. Counts and known nondealer cards can prove a player must follow suit; possible voids never become asserted voids.

Singles, pairs and tractors are checked against matching possible counter structures. If enumeration is incomplete or evidence is inconsistent, the context retains uncertainty. This can establish a secured team trick before the last opponent plays, while an ordinary side-suit ace stays provisional when a ruff remains possible. Complex throws remain conservative.

Every enumerated legal move retains its ID and gains immediate team outcome and resource comparisons. `safePointCarrying`, `economicalPartnerSupport`, `guaranteedProtection` and `clinchesAttackWin` distinguish feeding a secure teammate from blindly donating points or covering unnecessarily. `cheaperSameOutcome` compares the current winning seat, visible point contribution and control/structure costs; it does not prove identical future outcomes. Protecting a score threshold, an entry or the kitty can justify taking over. These are model guidance, never a silent replacement action. When exhaustive follow enumeration is unavailable, the full direct-card protocol remains in force.

## Decision context (compact observation v4)

`decisionContext` is computed by `src/decision-context.js` from the same permitted observation. It describes hand length, points, pairs and tractors by effective suit, counts higher/tied unlocated cards relative to the best held card, and identifies the public winner, partnership, remaining seats, proven voids and conditional final-trick kitty stakes. Unknown kitty values remain null.

When a complete `legalMoves` menu exists, every move receives an annotation with its points/trumps spent, winner and team currently ahead after that play, whether it overtakes the partner, broken/remaining pairs and remaining tractor length. The menu keeps exactly the same card IDs, order and membership; there is no heuristic pruning, ranking or selected recommendation. A winner-so-far does not predict what remaining opponents will do, and a proven void does not prove ownership of a trump.

This additional context is null during declarations and redeal choices; its explanatory prompt is added only when the context is present. The shared 12-second deadline, output limit, repairs, preserved fallback and private bidding behaviour remain unchanged.

## Strategic and action context (evaluation profiles v5/v6)

`strategic` (v5) extends the tactical facts with the current score target, readable move labels, level/joker consumption, remaining suit lengths, and publicly shown declaration cards. A shown nondealer card that has not been played remains in that seat's hand. A shown dealer card may have been buried, so its location is explicitly `dealer-hand-or-kitty` unless it belongs to the acting player's known hand or burial.

Each complete follow choice labels the winning team as `secured`, `lost` or `unsettled` using public plays and the remaining turn order. `secured` requires that no opponent remains to act; `lost` requires that no ally remains to act. Neither label predicts hidden cards or future points. Comparison sets retain all ties for their named statistic (for example, fewest level cards/jokers spent). They supplement the unchanged complete legal menu. The prompt explains conserving future control in a lost trick, banking disposable points in a secured win, and comparing short weak suits against long useful suits.

`strategic-v2` (v6) adds an explicit `actionContext` for the current tool. Menu IDs and physical card IDs have separate instructions. Direct card tools enumerate only held IDs; a follow requires exactly the lead's card count. Declaration tools enumerate the offered choices plus pass. Own-hand groups place jokers, every level card and the printed trump suit in effective suit `T`. Their pairs/tractors are building blocks, not a complete or recommended lead menu. The engine still validates every returned action and adjudicates throws.

These profiles use only the acting observation. They do not add sampled hands, an unseen-card oracle, or a replacement strategy. The original profiles remain reproducible evaluator options. Request metadata identifies the version, expected count and bounded argument categories on malformed tools, without retaining raw completion text or arbitrary field names.

## Optional reference advice and historical v7

Historical evaluator profiles retain the original reference candidate for reproducibility. Normal browser and server decisions no longer read `referenceAdvice`, including legacy saved flags. Each API seat instead chooses `promptLanguage:"zh"` (default) or `"en"`. The language variants use identical observations and action schemas, with semantically paired system instructions; no reference candidate or actual hidden allocation is included. Optional v17 analysis supplies aggregate estimates, never the sampled hands. Failure fallback is unchanged and remains explicitly attributed to the practice policy.

The suggestion comes through `src/peilian.js` with the same seat observation, and is checked locally against the acting hand and follow obligations. The model receives its current tool name and arguments alongside the full available action space. It may select a different legal action; the provider adapter never replaces a successful model choice with the advice. This is an explicitly assisted model, not an unaided-model strength claim. Internal policy estimates about possible unseen cards are guesses derived from the observation, not access to real hidden hands.

Request metadata records `advisorPolicy` and, after a parsed response, `referenceAdviceFollowed`. This is provenance, not a success metric: evaluations judge team wins and scores. Such a returned action remains `api`; forced moves and failure fallback keep their separate sources. Advice uses no extra provider request, and its local computation remains inside the same shared decision deadline. Disabling the setting restores unadvised partnership v8. Secret keys and private bidding disclosure rules are unchanged.

## Provider boundary and recovery

Browser connections use the selected Chat Completions, Responses or Messages protocol, with a discovered or manually entered model list. They do not ship a package catalog or silently select a model. Prices come only from explicitly returned metadata. The legacy CLI Token Plan boundary retains its validated text/tool catalog in `src/model-catalog.js`. Its request profiles use non-thinking mode and a complete-output cap by default. Qwen and GLM force the current function; DeepSeek uses automatic tool choice and the same strict response validator. Unknown compatible models retain their service's native options rather than receiving guessed reasoning flags. Documented Kimi Code IDs on `https://api.kimi.com/coding/v1` use `reasoning_effort:none` for the 12-second game loop; the service documents this as the K2.6 route, even when the returned model ID remains an alias. Setup explains the routing. This route requests a JSON object without native tools because live probes showed unreliable native-tool transport. Only a whole JSON argument object is accepted; prose, Markdown, wrappers and simultaneous native tools are rejected. It passes the same action parser and engine validation. Metering records `actionFormat:json_action`, zero native tool calls and one parsed action, without relabeling JSON as a native call. This exception never applies to an unrelated host or model ID.

The catalog request profiles and all three native response formats are covered by fixtures. GLM uses a forced tool and the normal 512-token output cap. Custom model entries still need validation against their provider. See the [catalog and request options](ai.md).

Offline simulation uses the same tool parser, chooses a deterministic legal action locally, and reports zero provider tokens. It is explicitly labeled in the UI. It is not a model-strength benchmark.

Default limits: 100 real request attempts per table, **12 seconds for the entire API decision**, and 512 output tokens per attempt. Setup can lower the deadline but cannot exceed 12 seconds; restored checkpoints and previously stored browser settings are clamped too. One timer covers the first request and at most one repair request. A quick failed or invalid response can be repaired within the remaining time. A timeout aborts the request and immediately hands that decision to 陪练, without granting another 12 seconds.

Every API fallback calls the same preserved `choosePeilian` strategy with the same permitted seat observation and decision ID, and the engine validates its action. The event remains `source:"fallback"`; the audit identifies `policy:"peilian"` and the reason. This applies to declarations, redeals, burying, leading, and following. Missing credentials and an exhausted request allowance use the same local fallback without issuing requests. The next decision tries the configured API if credentials and allowance permit. A defect in the local strategy itself pauses the table rather than applying an invalid action.

Using 陪练 on failed decisions maintains a defined local strategy, but does not create a lower bound on overall playing strength: valid API choices can still be strategically worse. There is no claimed hard currency cap; timeouts and provider billing must remain visible.

Pausing/restarting aborts the in-flight request and invalidates its runner generation. The local deadline finishes even if a provider fails to cooperate with cancellation. Late replies cannot apply an action or charge a replacement game's metrics. A late usage report is recorded separately and reconciles the original attempt once, without adding a second request or latency sample. Until usage is available, timeout consumption stays unknown; cancellation does not establish that provider-side billing stopped.

Each browser session owns one table and private checkpoint under ignored `data/browser-sessions/`. Reload uses its HttpOnly cookie to reconnect. Server restart restores the game paused but clears API keys. Same-browser tabs share a table; other browser sessions cannot read or operate it. Human seats can share the device with a handoff curtain; cross-device rooms are outside this release.

## Records and implementation boundaries

The UI distinguishes human, 陪练, simulated API, real API, forced and fallback actions. For a live continuous deal, `statsDeferred:true` returns only previously disclosed statistics and logs; the current full breakdown is released after scoring. Private bid work never changes public versions, pending seats, counters or SSE cadence. Accepted declarations are public, with detailed provenance released after the deal. The private audit records request starts, outcomes and late usage throughout. Estimates are not billed charges; unreported usage and provider quota charges remain unknown. The meter retains reported consumption even when output is truncated or an action is rejected. The server keeps metadata-only request audit entries; keys and authorization headers are never included. The downloadable replay includes public events plus events permitted to the chosen human viewer, not the shuffle seed or hidden hands. The private checkpoint supports exact engine restoration; the public export does not by itself reconstruct secret initial cards.

During ordinary burying/card-play turns, `busy` includes its seat, `api:true`, attempt number, start time, and the unchanged decision deadline. The browser animates that seat and shows remaining time, clearing it on completion, pause, or fallback. Drawing/closing expose no per-seat busy indicator; `dealClock` supplies only public draw/closing timing. Reduced-motion preferences disable the animation. Latency metrics show the mean and nearest-rank median/p95 of the latest 500 real request samples, including failed attempts and timeouts; simulated calls are excluded. Legacy mixed latency samples are cleared on checkpoint migration while usage counters remain intact.

REST routes: `GET /api/state?seat=n`, `GET /api/events?seat=n` (SSE), `POST /api/start`, `POST /api/action`, `POST /api/pause`, `POST /api/next`, `POST /api/autoplay`, `POST /api/presence`, and `GET /api/replay?seat=n`. Mutations require same-origin JSON requests. The server binds to loopback and exposes only public assets, public card/rule/training/player-setting/model-catalog helper modules. The pixel card atlas is a local public asset; retired renderers and dependencies are not served.

Browser SSE connections may include `client` and `visible` query fields. Presence POSTs contain `{clientId, visible}` and affect only connected clients. Once the sole human has been present, five seconds with no visible window for that seat pauses the table with `pauseReason:"away"`. Quick reconnects cancel the grace period; returning never auto-resumes. Manual pause uses `"manual"`, checkpoint restoration uses `"restored"`. See [table experience](table-experience.md). A zero request allowance permits no provider calls; invalid nonfinite numeric configuration is rejected before starting a game.


## Browser-owned API connections and table controls

Browser mutations require the session cookie and `X-Eighty-CSRF`; configured hosted origins additionally use Secure cookies and strict Host/Origin checks. State and SSE include the current CSRF value, a public-update revision, and non-secret connection settings. The revision advances only on public broadcasts, not private bid work. It lets clients reject stale configuration snapshots.

`POST /api/connections/save` takes a connection name, protocol, base URL, explicit model/rate list and optional key. A key is consumed into server memory and never returned. `POST /api/connections/forget` clears one key or all keys; `/api/connections/delete` removes custom settings. These actions pause an active table and cancel pending decisions. Seats refer to `connectionId` and a model. Unavailable connections use preserved 陪练 with no network attempt. Web sessions never fall back to server-wide environment credentials.

`POST /api/restart` starts a fresh match using the active table's seats and limits, resetting levels to 2. It preserves recent accounting and rejects late actions from the old game. `POST /api/next` is allowed only after `round_over` and preserves normal level/dealer progression. The UI confirms a restart and distinguishes it from the next deal; no new surrender scoring rule is introduced.

Local installations can explicitly import a pre-session checkpoint through `/api/restore-local`; this route is unavailable for hosted origins. `/api/audit` downloads the owning session's bounded metadata audit only when current-deal disclosure is allowed. See [deployment and key lifecycle](security-and-deployment.md).

## Partnership context (v8) and experimental search (v9)

Normal API decisions use v17 (v16 when analysis is disabled): the v8 partnership facts and complete action contract, plus a bilingual strategy guide covering entries, purposeful trump leads, point feeding, structural cost, burial and the final trick. The language setting changes the system prose; JSON keys, public facts and tool schemas stay identical. The goal is team wins, with no move-agreement reward. Endgame analysis is enabled by default as a clearly labeled experiment, switchable per seat. Eight plausible endings are compared from twelve cards remaining; an isolated worker has a 1.2-second local budget and inherits no credentials. A busy or incomplete analysis is omitted; it never blocks the server’s dealing clock. The shared 12-second model deadline includes this work. Earlier advice, sampling and joined-row variants remain historical evaluator profiles. See [the current study](research/ai-evaluation.md). No version sends actual other hands, unknown kitty, shuffle seeds or quizzes.

Evaluator callers can explicitly request bounded Qwen 3.8 thinking budgets or a compatible Chat Completions reasoning-effort value. A thinking budget must reserve at least 128 output tokens for the action and cannot be combined with reasoning effort. These experiments never raise the shared 12-second deadline or silently enable native reasoning flags for an unknown model. Request metadata records the actual output cap, requested reasoning settings and safe argument-value types; raw completion text is not retained.
