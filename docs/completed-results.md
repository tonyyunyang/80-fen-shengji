# Completed game results and traffic capacity

Implemented September 12, 2026. The private results archive stores the winner
and public replay of every newly completed deal, including AI-only tables.
Interrupted deals are excluded. The existing temporary checkpoints are separate.

## What happens when 100 people open the game

The front Worker validates an expiring, signed browser cookie and routes it to
one `GameTable` SQLite Durable Object. One hundred independent browser sessions
select one hundred independent tables, subject to admission limits. Tabs in
the same browser share its cookie and therefore its table. IP is not the table
identifier; different visitors behind one router do not share a game.

The browser renders cards, animation, audio and controls. The Cloudflare table
runs the authoritative rules, practice bots, AI controller and checkpointing.
The private sponsored broker holds provider bindings and enforces allowances.
The game is not a local-only engine with a thin API proxy.

This separation is appropriate for independent tables and trustworthy results.
It does not by itself guarantee that a Free account supports 100 continuously
active AI games. Current production settings admit 100 new tables per UTC day,
with 40 per salted-IP visitor per day and 12 per minute. The site allows 2,000
sponsored model attempts per day, with 500 per visitor and table. One hundred
visitors would share an average of only 20 sponsored attempts each. These are
allowances, not reserved per-player capacity. Practice fallback remains available.

Cloudflare's Free Durable Object allowance is 13,000 GB-s per day; active
objects are accounted at 128 MB each, regardless of their actual heap size.
At 100 continuously active tables, that is roughly 17 minutes of wall time
before that daily allowance is consumed, ignoring other account usage. Idle
objects that qualify for hibernation are different: their connected sockets
alone do not require continuous execution. Active game clocks, model calls,
and memory-only personal-key timers prevent hibernation while they are running.
See [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Music is fetched as a static asset and played on each visitor's device. It adds
no AI requests or server-side audio timer. Winning-game storage is also a small,
infrequent operation compared with active game execution and model requests.

Use `node scripts/verify-concurrency.mjs` for a bounded, synthetic local check
of 100 independent tables, sockets and legal actions. Its ignored report is
`output/scaling/100-tables.json`. This excludes production CPU quotas, global
network latency and real provider concurrency; it is not a capacity SLA.

## Storage: D1

The private D1 database is `eighty-results`, bound as `GAME_RESULTS`, in the EU
jurisdiction. Its ID is `0f9f95cf-789c-4936-8d81-0113adedd6c3`.
Keep current game state in Durable Objects and write the archive only after
an eligible terminal result. The schema is [0001_completed_games.sql](../migrations/0001_completed_games.sql).
There should be no public endpoint that accepts a claimed winner or uploads
a replacement replay. Browsers must not obtain database credentials or read
other visitors' records. The operator can query D1 in the Cloudflare dashboard.

The user clarified the definition: **every completed deal contributes one
record describing its winning side**, including pure AI/practice tables and
deals where the human side lost. A single deal is a fully played hand, not
necessarily the complete upgrade match through A.

The server gate requires `round_over` or `match_over`, four empty hands, a
final score, and a matching `round_scored` event for `completedDealEpoch`. It
derives the winner from the scoring engine. A repeated terminal notification
cannot create another row for the same game/deal epoch.

Only events from that completed epoch enter its public replay. Private draw
events, names, prompts, keys, shuffle seeds and later deals are not exported.
Old completed checkpoints are not automatically backfilled on deployment.

## Record contents

| Field group | Contents |
| --- | --- |
| Identity | Unique result ID, anonymous browser-session user ID, game ID and completed-deal epoch |
| Outcome | Completion time, dealer, winning team, final attack score and upgrade result |
| Rules | Ruleset/version, trump and before/after team levels |
| Seats | Human/practice/API role and model ID; no names, keys, private base URLs or prompts |
| Replay | This completed deal's public declarations, plays, tricks and settlement |
| Network | Validated Cloudflare visitor IP, or the literal `none` when unavailable |

The `replay_json` column is a JSON envelope containing gzip/base64 data, its
original byte length and event count. `decodedReplay()` in
`cloudflare/result-record.js` restores the public event array for operator
analysis. Summary fields remain directly queryable without decompressing the
replay. This keeps repeated JSON field names from consuming most of the Free
database's storage.

The anonymous user ID is derived with a domain-separated HMAC from the
existing signed browser session, never from its IP. It groups that browser
session's completed results, not a verified person across devices. Clearing cookies or a
session expiring can produce a new ID. Cross-device identity would require a
separate account feature.

Read IP only from the trusted front request's `CF-Connecting-IP`, validate its
format, and overwrite any client-provided internal header. Do not accept IP,
user ID or winner from the request body. Keep the IP in table memory until a
completed result exists; if it is unavailable after a restart, use `none`.
See [Cloudflare visitor IP headers](https://developers.cloudflare.com/fundamentals/reference/http-request-headers/).

An IP address is personal data, even though the goal is game analysis. Do not
use it as a public identifier. The setup screen includes a short player
notice describing the archive and IP retention. `RESULT_IP_RETENTION_DAYS=30` replaces raw IPs with `none` after 30 days while
retaining the game record; `0` retains them alongside the record. The daily
cleanup handles D1 rows, and outbox retries scrub expired IPs too. D1 Time
Travel backups have their own seven-day Free retention window. The database and exports stay private to the operator.

## Reliability without slowing play

Commit the authoritative final checkpoint and completed result together in
a synchronous SQLite transaction, using a separate local outbox. Its stable result key uses game ID and completed-deal epoch. Flush asynchronously with a prepared D1 insert;
`ON CONFLICT DO NOTHING` makes retries and repeated settlement notifications
idempotent. Never increment a win counter separately from that insert.

If D1 is unavailable, retain the outbox and retry with bounded backoff using
the object's alarm. Coordinate retries with the existing checkpoint-expiry
alarm; an object has one alarm. Pending results must not be discarded merely
because the browser closes or the ordinary seven-day save expires. Do not
pause a live card action while waiting for D1. Surface archive failures only
to the operator, without publishing private records.

The existing seven-idle-day checkpoint contains the current match, including
unfinished play and earlier results needed for resume. It is an operational
save, not this long-term archive. Claiming that the entire service stores only
completed games would therefore be inaccurate; the new archive alone excludes unfinished games.

## Quotas and useful queries

D1 Free includes 5 million rows read and 100,000 rows written per day, with
5 GB total storage and a 500 MB limit for one Free database. Index writes count
too. At one insert per completed deal, the write rate should be modest; measure
actual replay sizes before promising a retention capacity. Query by the indexed
user ID or completion time, and export/archive before approaching capacity.
See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

```sql
SELECT user_id, COUNT(*) AS completed_deals
FROM completed_games
GROUP BY user_id;

SELECT result_id, completed_at, final_attack_points, ip_address
FROM completed_games
WHERE user_id = ?
ORDER BY completed_at DESC;
```

This archive can report winners and completed-deal counts. Human win rates
can be calculated among completed human games using seat roles and winning
teams, but it cannot calculate abandonment or total-started-game rates because
unfinished games are intentionally absent.

The D1 database and schema were created through the signed-in Cloudflare
dashboard. Existing Wrangler OAuth scopes were left unchanged. Normal code
deployments reference the existing database binding; CLI database-management
commands separately require D1 permission.
