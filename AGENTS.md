# Working in Eighty

Read README.md first, then the relevant rule, protocol or deployment document.

- Node 22+: `npm ci --ignore-scripts`, `npm start`, `npm test`, `npm run check`.
- Keep rules and state transitions deterministic. `src/game.js` and `src/rules.js` must not import vendor code or make network calls.
- Keep `vendor/peilian/reference-core.cjs` unchanged; its checksum is verified. `src/peilian.js` is its runtime boundary.
- Model seats receive only their own observation. Never send full state, shuffle seeds, other hands or quizzes to a provider.
- API decisions have one shared 12-second deadline including repairs. Failure uses preserved 陪练; stale losing bids are silently superseded. Late usage remains auditable while late actions are rejected.
- Continuous dealing never pauses for private model work. No eligibility, thinking, request-count or timing side channels during bidding. Closing lasts at least five seconds.
- Browser keys exist only in the owning server session's memory. Never store them in browser storage, checkpoints, logs, code or fixtures. The web server must not inherit deployment API keys.
- Preserve cookie/CSRF isolation, DNS-pinned public endpoint checks, redirect rejection and credential redaction. See docs/security-and-deployment.md.
- Keep genuine model actions, simulation, forced actions and fallback distinguishable. Routine checks are offline; live evaluations must be explicitly opted into and bounded.
- Three.js is decorative and renders on demand. Cards and controls remain accessible HTML with reduced-motion and CSS fallbacks.
- Update behavior, documentation and relevant regression examples together. Browser checks cover manual play, mixed seats, restart/next, narrow screens and a clean console; captures belong in ignored output/playwright/.
- Use focused feature branches and reviewable commits. Scan the complete publication history for secrets; don't publish local runtime data or private planning notes. Follow the repository's PR checks before merging.
