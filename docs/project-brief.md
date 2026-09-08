# Project brief

Eighty is a four-seat Shanghai 80分 game with independently implemented rules, a preserved practice strategy, and model players making real tool calls.

## Product contract

Each seat is human, 陪练, or an API model. One-human tables deal continuously with private concurrent bidding. Shared-device human games use handoff curtains. Each browser session owns its own table and API connections; cross-device rooms are outside this release.

The engine validates every action. Model contexts contain only the acting seat's information. Calls are bounded and metered, with preserved 陪练 fallback and explicit unknown usage. The UI makes the current level, trump, turn and last-trick winner clear.

## Milestones and acceptance

| Milestone | Acceptance |
| --- | --- |
| Rules engine | Card conservation, printed identities, following, scoring and progression examples pass |
| Playable table | Complete manual/offline games, continuous bidding, handoff, restart and next-deal controls |
| API players | Native tool parsing, bounded recovery, private observations and metering |
| Own-key connections | Per-browser keys, custom models/prices, no secrets in persisted data, safe outbound requests |
| Public source | Simple README, attribution, offline CI and secret scanning, no private development history |
| Future evaluation | Paired deals, seat/team rotation, held-out scenarios and separate fallback accounting |
| Future education | Test whether exercises improve learning before claiming effectiveness |

## Architecture

Node 22+ serves native browser modules. The independent core is separate from the preserved strategy, the provider adapters, browser sessions and presentation. Three.js supplies optional decoration; ipaddr.js classifies provider addresses. No build step is needed.

Work should start from concrete acceptance examples and update the relevant contract in the same change. Passing fallback-assisted games demonstrates reliability, not model strength. Accounts, matchmaking, rankings, payments and large-scale hosting remain future work.
