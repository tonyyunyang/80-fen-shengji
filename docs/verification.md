# Verification

Current version: the integrated pixel game, September 10, 2026. Live AI outcomes and their limits are separate in [the current study](research/ai-evaluation.md).

## Offline gates

- `npm test`: **173 passing tests**.
- `npm run check`: **86 modules** checked; preserved Peilian checksum verified.
- Coverage retains deterministic rules, all physical card identities, legal following, private observations, cookie/CSRF isolation, provider deadlines and late accounting.
- New checks cover one-row geometry through 25→33→25, perspective/partner placement, all twelve court images and both jokers, correct team result labels, completed-match levels, and a learning recap after all cards have been played.

## Browser checks

The approved art is rendered by the real game client. Controlled fixtures use the real engine and its local save/restore path; no public fixture endpoint or scene switch was added.

- Empty-session SSE updates are handled without a null-hand error, so Start becomes enabled after connection.
- A fresh browser opens the menu; Rules, Credits, Settings and the 54-face card gallery work.
- Ordinary continuous dealing and bidding reach the human's real hand.
- The real dealer's 33 cards remain one row. All 33 cards are reached correctly in both hover directions.
- Dragging with other cards selected creates exactly one ghost; other hand transforms and resting geometry remain unchanged. Escape cancels without submission.
- Confirming eight buried cards produces the real 25-card hand in one row. Space/keyboard selection and human submission work.
- A mixed human/Peilian/simulated-API deal completes with zero paid requests. Trick collection and the real score/result panel are displayed.
- Notebook history uses actual public events. Live learning and completed-deal recap questions leave game version, score and pause state unchanged.
- Main-menu seat edits leave the current table unchanged. Continue, next deal and language reload preserve the saved game.
- At 390×844, the entire logical table fits the viewport, including one complete hand row and its footer. Reduced motion disables decorative animation.
- Browser console checks reported no errors or warnings during the completed workflows.
- Dialog headings and close buttons remain visible while scrolling, at 1440×960 and constrained 920×620 / 560×740 viewports. Backdrop click, Escape and the close button dismiss correctly; password fields clear immediately. An inside-to-outside text-selection drag does not dismiss the dialog.
- Pause backdrop resumes play; Rules opened from Pause returns to Pause when dismissed. The background page stays locked during a modal.
- Inline per-seat Add / Manage connection opens the correct profile, saves back to that seat and returns focus to its model selector. No real key or inference request is used in these browser fixtures.
- Original Chinese and English wordmarks were visually checked. At 560px width the page has no horizontal overflow; screen-reader heading text remains present.
- API seats select Chinese or English strategy prompts and an optional experimental endgame analysis; the selected language survives reload, and old advice flags are ignored.
- The control row stays below the hand; four simultaneous four-card plays and their captions remain above its hover area. Side portraits avoid the trump and score panels. Checks include 1440×960, 1405×907, 1280×800, 1920×1080, 560×740 and 390×844.
- Standard and maximum card/text preferences retain one row during 33-card burial; selecting seven then eight cards leaves the hand's document position stable, and confirmation returns it to 25 cards. Short windows uniformly shrink the complete scene; neither page nor hand scrolling is required, including the largest card/text preferences.
- Public closing time is visible in the control row while the deck and declaration stay separate. Spectator status remains visible without a private hand, and the shared-device handoff curtain has its own reserved space.
- Bidirectional pointer sweeps reach every card; dragging one card does not move the hand, and a single-card drop during a multi-card follow returns without changing the game. The mixed human/practice/simulated fixture completes, proceeds to the next deal and restarts with zero paid requests.
- A stale flight element is ignored when switching games clears the live deal clock; the next render removes it without interrupting the state update.

Current regression checks include 1920×1080, 1440×900, 1280×720, 1024×600, 800×600, 560×740 and 390×844, across dealing/closing, 25-card play and 33-card burial. Scaled pointer sweeps visit every card, including all 33 cards in both directions in visible and headless browser sessions. Retained hover identities re-anchor after card reordering and restore their pose marker after state reconciliation; a single legal drag submits exactly one card, and an incompatible multi-card follow returns without changing game state. Court figures retain proportions, the 9/10 pip fields do not intersect either index, and the removed self-taste credit stays absent.

Curated screenshots and GIFs live in `docs/media/`, with recording notes in [media documentation](media/README.md). Raw captures and local diagnostics stay in ignored `output/`. Captures demonstrate the checked browser, not a frame-rate guarantee for every device.

## Scope limits

This release integrates the approved interface and game flow. It does not establish stronger AI play, provide online multiplayer rooms, or include a full audio/tutorial package. These are listed as future work in [game direction](roadmap.md).


## Public release checks

The 0.2.0 showcase uses actual anonymous local-practice games. Both twelve-second GIFs show real hover, pair selection, a single-card drag and trick collection, with zero API requests and a clean console. Menu screenshots cover Chinese and English; the card sheet and social image use the project's live card and wordmark components.

The main table's source remains the approved version. The only rendering correction during packaging is scoped to main-menu court-art positioning. `npm run check` also validates local documentation links, media size limits and the single HTML entry point. CI tests Node.js 22 and 24 and scans complete publication history for secrets.
