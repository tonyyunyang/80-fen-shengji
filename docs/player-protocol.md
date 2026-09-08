# Player protocol v3

Status: implemented. Contracts are updated alongside their implementation. Source of truth for wire fields: `src/game.js`, `src/providers.js`, `server/session.js`.

Continuous dealing is implemented for zero or one human. Shared-device multi-human games retain the ordered handoff mode. The provider observation encoding remains compact JSON v2; this protocol version adds concurrent declaration bindings and private live-deal accounting.

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

Provider requests use a self-contained compact JSON observation (`v:2`) with a stable rules prompt. The engine computes following obligations locally. When exhaustive follow enumeration requires at most 20,000 combinations and produces at most 48 legal moves, the observation includes every legal card combination in `legalMoves`. The model chooses its integer ID using `play_move`; IDs are scoped to that request and decoded against that same list. A unique legal follow is applied locally and recorded as forced. Larger searches or menus use direct card IDs and authoritative follow obligations. No partial or strategy-ranked list is presented as complete.

In continuous mode, a separate clock draws one card every 500ms (700ms optional). All seats may bid from already received cards; silence does not block another draw. The human action body is `{seat, bidContext, action:{type:"declare",choice}}`. `bidContext` carries game ID, deal epoch and hand count. The engine rejects a context from another deal or a card requirement beyond that received prefix. API jobs additionally retain and validate the originally offered menu. A later equal/stronger opposing bid silently supersedes a weaker proposal; there is no automatic pair upgrade, repair request, or fallback bid for losing that race.

At most one API bid request runs per seat. New cards/public declarations are coalesced into the latest review after a two-second minimum start interval. Eligible seats receive one final review for each full-hand/declaration/closing context, including after earlier passes. Ineligible seats receive none. Countdown ticks do not create new reviews. Closing begins after card 100 and lasts five seconds, renewed only by accepted bids. A closing cutoff limits pending jobs, with a 100ms local fallback margin, while their original 12-second decision cap never moves. Bids at/after the cutoff are too late. See [continuous dealing](continuous-dealing.md).

The historical ordered mode still binds each declaration to a sequential pending decision. It is retained for old fixtures/checkpoints and shared-screen multi-human handoffs. No paid acknowledgement is sent after a draw or successful move; the next observation supplies current state.

## Provider boundary and recovery

OpenAI uses Responses function calls; the Anthropic adapter uses Messages tool-use blocks; Alibaba Token Plan uses the OpenAI-compatible Chat Completions interface configured through the existing Qwen environment variables. Its nine supported text/tool models are selected from `src/model-catalog.js`, with dated Singapore price references. Catalog profiles request non-thinking mode and a complete-output cap. Qwen and GLM force the current function; DeepSeek uses automatic tool choice and the same strict response validator. Token Plan model IDs outside the catalog are rejected before starting a table or making a request. Custom OpenAI/Anthropic model IDs remain user-entered.

The catalog request profiles and all three native response formats are covered by fixtures. GLM uses a forced tool and the normal 512-token output cap. Custom model entries still need validation against their provider. See the [catalog and request options](token-plan-models.md).

Offline simulation uses the same tool parser, chooses a deterministic legal action locally, and reports zero provider tokens. It is explicitly labeled in the UI. It is not a model-strength benchmark.

Default limits: 100 real request attempts per table, **12 seconds for the entire API decision**, and 512 output tokens per attempt. Setup can lower the deadline but cannot exceed 12 seconds; restored checkpoints and previously stored browser settings are clamped too. One timer covers the first request and at most one repair request. A quick failed or invalid response can be repaired within the remaining time. A timeout aborts the request and immediately hands that decision to 陪练, without granting another 12 seconds.

Every API fallback calls the same preserved `choosePeilian` strategy with the same permitted seat observation and decision ID, and the engine validates its action. The event remains `source:"fallback"`; the audit identifies `policy:"peilian"` and the reason. This applies to declarations, redeals, burying, leading, and following. Missing credentials and an exhausted request allowance use the same local fallback without issuing requests. The next decision tries the configured API if credentials and allowance permit. A defect in the local strategy itself pauses the table rather than applying an invalid action.

Using 陪练 on failed decisions maintains a defined local strategy, but does not create a lower bound on overall playing strength: valid API choices can still be strategically worse. There is no claimed hard currency cap; timeouts and provider billing must remain visible.

Pausing/restarting aborts the in-flight request and invalidates its runner generation. The local deadline finishes even if a provider fails to cooperate with cancellation. Late replies cannot apply an action or charge a replacement game's metrics. A late usage report is recorded separately and reconciles the original attempt once, without adding a second request or latency sample. Until usage is available, timeout consumption stays unknown; cancellation does not establish that provider-side billing stopped.

Each browser session owns one table and private checkpoint under ignored `data/browser-sessions/`. Reload uses its HttpOnly cookie to reconnect. Server restart restores the game paused but clears API keys. Same-browser tabs share a table; other browser sessions cannot read or operate it. Human seats can share the device with a handoff curtain; cross-device rooms are outside this release.

## Records and implementation boundaries

The UI distinguishes human, 陪练, simulated API, real API, forced and fallback actions. For a live continuous deal, `statsDeferred:true` returns only previously disclosed statistics and logs; the current full breakdown is released after scoring. Private bid work never changes public versions, pending seats, counters or SSE cadence. Accepted declarations are public, with detailed provenance released after the deal. The private audit records request starts, outcomes and late usage throughout. Estimates are not billed charges; unreported usage and Token Plan Credits remain unknown. The meter retains reported consumption even when output is truncated or an action is rejected. The server keeps metadata-only request audit entries; keys and authorization headers are never included. The downloadable replay includes public events plus events permitted to the chosen human viewer, not the shuffle seed or hidden hands. The private checkpoint supports exact engine restoration; the public export does not by itself reconstruct secret initial cards.

During ordinary burying/card-play turns, `busy` includes its seat, `api:true`, attempt number, start time, and the unchanged decision deadline. The browser animates that seat and shows remaining time, clearing it on completion, pause, or fallback. Drawing/closing expose no per-seat busy indicator; `dealClock` supplies only public draw/closing timing. Reduced-motion preferences disable the animation. Latency metrics show the mean and nearest-rank median/p95 of the latest 500 real request samples, including failed attempts and timeouts; simulated calls are excluded. Legacy mixed latency samples are cleared on checkpoint migration while usage counters remain intact.

REST routes: `GET /api/state?seat=n`, `GET /api/events?seat=n` (SSE), `POST /api/start`, `POST /api/action`, `POST /api/pause`, `POST /api/next`, `POST /api/autoplay`, `POST /api/presence`, and `GET /api/replay?seat=n`. Mutations require same-origin JSON requests. The server binds to loopback and exposes only public assets, public card/rule/training/player-setting/model-catalog helper modules, and three explicitly whitelisted Three.js distribution/license files.

Browser SSE connections may include `client` and `visible` query fields. Presence POSTs contain `{clientId, visible}` and affect only connected clients. Once the sole human has been present, five seconds with no visible window for that seat pauses the table with `pauseReason:"away"`. Quick reconnects cancel the grace period; returning never auto-resumes. Manual pause uses `"manual"`, checkpoint restoration uses `"restored"`. See [table experience](table-experience.md). A zero request allowance permits no provider calls; invalid nonfinite numeric configuration is rejected before starting a game.


## Browser-owned API connections and table controls

Browser mutations require the session cookie and `X-Eighty-CSRF`; configured hosted origins additionally use Secure cookies and strict Host/Origin checks. State and SSE include the current CSRF value, a public-update revision, and non-secret connection settings. The revision advances only on public broadcasts, not private bid work. It lets clients reject stale configuration snapshots.

`POST /api/connections/save` takes a connection name, protocol, base URL, explicit model/rate list and optional key. A key is consumed into server memory and never returned. `POST /api/connections/forget` clears one key or all keys; `/api/connections/delete` removes custom settings. These actions pause an active table and cancel pending decisions. Seats refer to `connectionId` and a model. Unavailable connections use preserved 陪练 with no network attempt. Web sessions never fall back to server-wide environment credentials.

`POST /api/restart` starts a fresh match using the active table's seats and limits, resetting levels to 2. It preserves recent accounting and rejects late actions from the old game. `POST /api/next` is allowed only after `round_over` and preserves normal level/dealer progression. The UI confirms a restart and distinguishes it from the next deal; no new surrender scoring rule is introduced.

Local installations can explicitly import a pre-session checkpoint through `/api/restore-local`; this route is unavailable for hosted origins. `/api/audit` downloads the owning session's bounded metadata audit only when current-deal disclosure is allowed. See [deployment and key lifecycle](security-and-deployment.md).
