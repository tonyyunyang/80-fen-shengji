# Changelog

## Unreleased

- Double the default dealing pace to 250ms per card; retain 500/700ms options and the shared five-second closing window.
- Freeze each deal flight's trajectory and let adjacent flights overlap, reserve declaration space, and ease hand reflow after public bids.
- Strengthen paper and card-landing sounds, preserve the final play's accent, and briefly lower music under effects without altering the approved recording.
- Recognize an upward lift across the hand edge over the wider felt area, with a soft highlight and carried-card hint; return-to-hand cancellation and exact-group validation remain.

- Merge the website branch's shared improvements into `main`, while retaining `codex/tonytheyang-site` as the production deployment channel.
- Play online at **[eighty.tonytheyang.com](https://eighty.tonytheyang.com/)**. Add direct links to the bilingual READMEs, player guides and repository/release metadata.
- Keep larger, horizontally scrollable phone hands with reachable controls in portrait and short landscape; horizontal swipes do not select or play, and upward drags retain move validation.
- Add the original After Eighty soundtrack, independent music/effect controls, and expanded deal/play/capture/scoring sounds.
- Add optional Workers Free hosting with isolated SQLite tables, hibernating WebSockets, private host secrets, supported hosted text models and visitors' own API connections.
- Archive only completed deals in optional private D1 storage, including all four initial hands, kitty, plays, trump, level and settlement. Preserve retries, idempotence, legacy replay decoding and IP retention.
- Harden provider-response redaction and diagnostics; preserve the normal Node/BYOK path, private observations and optional Node-only endgame analysis.

- Identify setup seats as You, Teammate, Left opponent and Right opponent, grouped by partnership with table positions. Keep the seat diagram, menu summary and API connection hints consistent, including shared-device and spectator setups.
- Reject stale browser snapshots from another viewing seat; scope counters to the server session so reconnecting can accept a restored save. Human play controls require ownership of the displayed hand.
- Cancel a held group when viewport geometry changes, including a release that arrives before the resize event, without submitting cards or losing the selection.
- Return HTTP 403 for malformed multi-byte CSRF headers without exposing an internal comparison error.
- Consolidate bilingual interface labels, remove unused imports and retired card-preview styles, simplify the active layout path and format the client/CSS for maintenance. The approved artwork and hand interaction remain intact.
- Use controlled clocks for cutoff and late-usage evaluation regressions instead of short wall-clock waits that depended on CI load.

## 0.3.0 · 2026-09-10 · Arcade table and group play

- An arcade finish adds original flowing ink, foil glints, richer paper/brass surfaces, directional card landings and public declaration/trick accents.
- Scoring sparks travel toward their actual recipient, the score ticket shows progress toward 80, and the round reveal includes an accessible count-up and team-aware celebration.
- Full/Soft/Off effects, static fallback, reduced motion and bounded background drawing. Expanded opt-in synthesized paper, capture and result sounds.
- Drag any selected card to carry and play the complete selection. Unselected cards still drag individually; the Play button remains available.
- Carried groups gather into a short fan with a count badge and a legality hint. Invalid drops and cancellations return every card to its own slot while keeping the selection.
- Preserve stable hover and gesture identities across public redraws, with immediate cancellation on resize and reduced-motion support. Burial continues to require explicit confirmation.
- Refresh the Chinese/English READMEs, current gameplay media, press kit, package metadata and player documentation for the merged arcade table. The existing deck atlas, rules and provider behavior remain unchanged.

## 0.2.0 · 2026-09-10 · The pixel table

- One approved pixel table replaces earlier room and hand-lab interfaces.
- A game menu, separate general/seat settings, Chinese and English, hotseat privacy and saved games.
- Full-window table fitting, a single hand row at 25/33 cards, stable hover and one-card drag-to-play.
- Original title lettering, clearer pixel suits/court cards and visible partnership roles.
- A public-card notebook, trick review, optional learning, reduced motion and sound controls.
- Independent bilingual model guidance, bounded experimental endgame analysis and stricter Kimi JSON actions.
- Chinese/English READMEs and contribution guides, an Apache-2.0 license, curated docs and actual gameplay media.

External AI remains experimental. Cross-device rooms and a public hosted demo are not part of this release.

## 0.1.0 · 2026-09-08 · First public snapshot

- Deterministic Shanghai rules, a preserved local practice policy and structured API seats.
- Private continuous bidding, browser-session credentials, saved games and offline verification.
