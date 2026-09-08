# Table experience

Implemented table behavior. The table supports local play and independent browser sessions.

## Visual approach

A green felt surface, warm beveled rails, restrained lighting, and paper card faces make the table the primary surface. An in-table “入座开局” button starts with the current setup, including on narrow screens. Setup collapses when a game starts. Per-seat model choices and price references stay available in the seat settings.

Three.js **0.185.1**, pinned in the lockfile, renders only the decorative table. It is served locally; no CDN, remote font, or image request is needed. The renderer imports lazily, caps pixel ratio at 1.5, and draws for initialization, resize, appearance changes and brief pointer movement. There is no idle render loop, following the [Three.js on-demand rendering pattern](https://threejs.org/manual/en/rendering-on-demand.html). Hidden pages stop rendering; reduced motion disables parallax. Coarse pointers have no parallax.

If WebGL2, the module import, or context creation fails, the CSS table remains playable. Context loss also falls back to CSS. A local appearance switch turns off the 3D layer without changing the game.

Cards, score, thinking indicators, buttons and dialogs remain HTML. The renderer receives no game state and cannot select cards, make provider calls, or affect timing. This keeps game logic independent of the visual library. Three.js is MIT licensed; its unchanged license is available at `/vendor/three/0.185.1/LICENSE` and in the installed package. The preserved 陪练 attribution remains separate.

## Reading the deal and collecting a trick

The play surface separates deal identity from physical card movement. The table center now belongs to cards. A face-down deck is visible during dealing, with a count that includes the eight reserved bottom cards. The final bidding countdown sits beside that deck. During burial, an empty card outline marks the waiting space; after burial, the eight covered bottom cards sit at the table edge.

A sticky information bar explicitly shows **本局打几**, the named trump suit or **无主**, and the dealer and human's role. It labels a provisional declaration as **当前亮主**. Before different team levels are resolved, the level is **待定**. After scoring, it still shows the level actually played in this deal, using `trump.rank`, even though the match levels have already advanced.

Each public play has a seat, lead/follow label and card count. Completing a trick preserves all four plays for **850ms**, flips them face down over **300ms**, then gathers and moves the backs toward the winner over **450ms**. A covered pile and **上一墩收牌** remain beside that seat. The summary below the table also names the winner and the trick's points, including zero points.

The display clock is separate from the engine. API decisions and dealing retain their existing deadlines and never wait for this animation. New public plays arriving during collection are shown when it finishes. A human may preselect the next play, with submission enabled after collection. Fast spectator updates coalesce to the latest completed trick, keeping at most one animation instead of building a queue.

Pause, hidden tabs and reduced motion settle directly to the covered pile. Reload shows the current state without replaying old collections. Game/deal/viewer changes reset presentation identity; scoring alone does not. All motion uses existing public trick records. No new game event, API request, private hand, eligibility signal or usage counter is needed.

Click a played group or **回看** to inspect the complete trick. Large fans show an exact total and a **＋N** badge for cards folded out of the compact view. The dialog shows all cards; an unfinished trick is explicitly a snapshot at opening time. Cards use corner-aligned ranks with enough exposed width for two-character labels such as 10.

Responsibilities stay separate: `table-flow.js` owns the small presentation clock and deal facts, `table-view.js` renders public table information, and `table-flow.css` owns the layout and motion. The authoritative engine and provider adapters are unchanged by this pass.

## Human controls

- A click toggles one physical card. Double-clicking selects both held copies of that face. Shift-click adds a contiguous range.
- The hand uses one tab stop. Left/right, Home and End move between cards; Space toggles; Shift plus an arrow extends a range. Enter submits a valid selection; Escape clears it.
- The hand and canvas keep their DOM identity across public updates. Selection, focus and horizontal scrolling survive unrelated changes. A new decision clears the old selection.
- Selected-card chips show the complete proposed play even when some selected cards are off-screen.
- Burial requires exactly eight cards. Follow selection checks suit, pairs and tractor obligations using the engine's public rule helpers. A lead must belong to one effective suit. These checks use only the player's hand and public cards; throw success remains the authoritative engine's decision.
- “帮我选牌” is a local legal-selection convenience, not an API recommendation or a claim of strategic quality. It costs no tokens.
- Submission binds the current decision or bidding context immediately and permits only one in-flight action. The server still rejects stale or duplicate actions.
- “上一墩” displays the most recent completed public trick, winner and points. It remains available after the table animation clears the cards.

## Connection and presence

The header shows connection status; disconnected controls cannot submit. SSE reconnects automatically and supplies a fresh seat observation. Reload preserves the server's active table.

For a table with exactly one human, once a browser has shown that human's seat, all of that seat's windows being hidden/disconnected starts a five-second grace period. Another visible window or a quick reconnect cancels the pause. Public draws do not reset the grace period. If the grace expires, the server pauses, cancels current API decisions and preserves the remaining deal/closing clock. Returning does not resume automatically.

Spectators cannot activate this mechanism, and headless bot tables and shared-screen multiple-human mode retain their existing behavior. A viewer from a previous game cannot pause a replacement game. This is a convenience for trusted local play, not identity authentication.

The presence route carries only a per-page client ID and visibility flag. Bid eligibility, API work, usage counters and private passes remain undisclosed during continuous play; only accepted bids become public.

## Behavioral examples to retain

| Situation | Expected result |
| --- | --- |
| Human chooses seven cards for burial | Submit disabled; explains one more is needed |
| Human holds a pair but selects two singles to follow a pair | Explains the pair obligation; no network action |
| Human scrolls a long hand while cards arrive | Existing cards and scroll position remain |
| Two rapid submit clicks | One HTTP action, one game transition |
| A late single bid loses to an accepted single | Silently discarded; no upgrade or fallback bid |
| Browser disappears for four seconds | Table continues and reconnects |
| All sole-human windows disappear for five seconds | Table pauses with an explanation |
| Request allowance is zero | No API requests; preserved 陪练 acts as fallback |
| Local save has invalid cards, usage or clock data | Rejected before replacing the current table |
| WebGL unavailable or lost | CSS table; all cards and controls still work |
| The next API lead arrives during collection | The completed four-player trick still flips and collects; the new play follows |
| The last trick contains zero points | The winner and covered pile remain explicit |
| Match levels advance from 2 after scoring | The current-deal bar still says 打 2 |
| A compact fan cannot show every card | Its total and ＋N badge are visible; opening it shows the full trick |

The offline rules/provider suite and browser fixtures verify these behaviors. See [verification](verification.md) for measured results and remaining limits.


## Restart and API configuration

The toolbar exposes **重新开始** and **下一局**. Restart confirmation explains that levels reset and existing API consumption remains; canceling has no game effect. Next-deal controls are enabled only at a completed deal. Recent table usage stays visible after restart.

**API 连接** manages the browser's own keys, endpoints and model/price lists. The key field clears after submission or close, while success and error feedback stays inside the dialog. No paid probe is triggered by saving. Changing connections pauses active play. With no key, API seats explicitly identify their 陪练 fallback instead of implying a model is active.
