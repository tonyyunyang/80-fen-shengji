# Working in Eighty

Read README.md and CONTRIBUTING.en.md first, then the relevant document from docs/README.md.

- Node 22+: `npm ci --ignore-scripts`, `npm start`, `npm test`, `npm run check`.
- Keep rules and state transitions deterministic. `src/game.js` and `src/rules.js` must not import vendor code or make network calls.
- Keep `vendor/peilian/reference-core.cjs` unchanged; its checksum is verified. `src/peilian.js` is its runtime boundary.
- Model seats receive only their own observation. Never send full state, shuffle seeds, other hands or quizzes to a provider.
- API decisions have one shared 12-second deadline including repairs. Failure uses preserved 陪练; stale losing bids are silently superseded. Late usage remains auditable while late actions are rejected.
- Continuous dealing never pauses for private model work. No eligibility, thinking, request-count or timing side channels during bidding. Closing lasts at least five seconds.
- Browser keys exist only in the owning server session's memory. Never store them in browser storage, checkpoints, logs, code or fixtures. The web server must not inherit deployment API keys.
- Preserve cookie/CSRF isolation, public endpoint checks, redirect rejection and credential redaction. Keep Node requests DNS-pinned; the Workers transport has the separate public-network contract in docs/security-and-deployment.md.
- Keep genuine model actions, simulation, forced actions and fallback distinguishable. Routine checks are offline; live evaluations must be explicitly opted into and bounded.
- The pixel game at `public/index.html` is the only runtime interface. Keep configuration outside play, use one hand row for every phase, and preserve stable hover. Click selects in hand. Dragging a selected card carries the complete selection; an unselected card moves alone. A legal drop plays that exact group once; incompatible drops preserve selection and return every card to its slot. Burial still requires confirmation. Cards and controls remain accessible HTML with reduced-motion support. Do not add alternate table or hand-lab entry points.
- Update behavior, documentation and relevant regression examples together. Browser checks cover manual play, mixed seats, restart/next, narrow screens and a clean console; captures belong in ignored output/playwright/.
- Use focused feature branches and reviewable commits. Scan the complete publication history for secrets; don't publish local runtime data or private planning notes. Follow the repository's PR checks before merging.
- Keep feature branches only while work is active. After confirming a PR merge and checking for newer unmerged work, delete its remote and local branch and prune stale remote references. Preserve `main` and release tags.

## Website edition exception

Tony explicitly requested `codex/tonytheyang-site` as a maintained, long-lived
deployment branch for his personal website. Preserve this branch. Keep game
and hosted-service changes in this repository; the website owns its project
entry and promotional artwork, not a second game copy. Read
`docs/site-edition.md` for the deployment contract. Sponsored API use is an
explicit host feature, disabled by default; ordinary upstream web sessions
remain BYOK. Never infer authorization for paid requests from saved secrets.

The default website deployment uses Workers Free-compatible SQLite Durable
Objects and hibernating WebSockets, with no Containers or R2 binding. Provider
endpoints, including supported plan endpoints, are operator-authorized; do not
reintroduce a blanket plan-name prohibition. Keep host keys in Worker Secrets.
Tony also explicitly requested visitors' own URL/key connections on Workers.
Keep those keys only in the owning table's memory, clear them after 30 minutes
without public browser activity or on restart, and persist only metadata.
Workers cannot pin a custom node:https lookup: validate public DNS on every
call, reject redirects, and use strictly public fetch with no private-network
bindings. Never route a host secret to a visitor-selected URL. Optional Node
worker-thread endgame analysis stays disabled; the shared rules, practice
policy and single pixel-table UI remain authoritative.
