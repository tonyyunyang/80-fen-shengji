# Make the next hand better

[简体中文](CONTRIBUTING.md) · [Back to Eighty](README.en.md)

Welcome—and feel free to play a few games first. Contributions can improve interaction, rules examples, translations, artwork, accessibility or partnership strategy.

**Please contribute through pull requests. Maintainers review PRs periodically, so replies may take a while.** This is a spare-time project with no fixed review schedule. Small, complete changes are usually easier to review.

## Your first PR

1. Fork the repository and create a descriptively named branch.
2. Install Node.js 22+ and run the commands below.
3. Make one concrete improvement, with relevant validation and documentation.
4. Open a PR against `main`, explaining the problem, resulting behavior and how to check it.

```sh
npm ci --ignore-scripts
npm start
# Run verification in another terminal
npm test
npm run check
```

The game runs at http://127.0.0.1:5173. No API key or build step is needed. Routine tests are offline. Include screenshots or a short GIF for visual changes; include trump, hands, plays and expected results for a rules change.

## Useful contributions

- **Interaction and accessibility:** stable hover, keyboard controls, focus, contrast and window sizing.
- **Rules:** reproducible edge cases. Regional variants differ; explain the distinction from this project's implemented rules.
- **Translation and teaching:** natural Chinese or English, especially card-game terminology and beginner explanations.
- **Art:** preserve the approved pixel table and clear suits; document asset sources and licenses.
- **AI:** improve team wins and score outcomes, with comparable evidence and separate timeout/fallback accounting.

For a large design or rules change, an issue first can save time. Small fixes can go straight to a PR. AI-assisted contributions are welcome; understand, review and test them like any other contribution.

## Shared boundaries

- `public/index.html` is the only production table. Do not add hand-lab, old-table or demo entry points.
- Keep `src/game.js` and `src/rules.js` deterministic, without network or vendor-policy calls.
- Keep the upstream `vendor/peilian/reference-core.cjs` intact; use its adapter boundary.
- Models receive only their own observation, never other hands, shuffle seeds, unknown kitty contents or quiz answers.
- Preserve the shared 12-second decision deadline, failure fallback, continuous dealing and private bidding.
- Do not include keys, session checkpoints, raw private replays or request logs in a PR. Use synthetic examples.

These boundaries protect fairness and let the interface, rules and model behavior evolve separately. See [architecture](docs/architecture.md) and the [player protocol](docs/player-protocol.md).

## Validation

Run `npm test` and `npm run check`. For UI work, also try manual play, mixed seats, next/restart, a narrower window and a clean browser console. Media capture should use local practice bots, not paid models.

Live model evaluation requires your own credentials, explicit opt-in and bounds on requests, wall time and output. Do not assume permission to use someone else's saved key. Measure partnership wins, not agreement with the practice policy. See [evaluation guidance](docs/research/ai-evaluation.md).

## Review and licensing

A PR description can be short: explain the concrete issue, final behavior and relevant checks. Retain sources, licenses and required notices for third-party code or art. Unless explicitly agreed otherwise, contributions are submitted under [Apache-2.0](LICENSE).

Please follow the [community guidelines](CODE_OF_CONDUCT.md). Report security issues through the [private channel](SECURITY.md).

Thanks for making the table better. Enjoy the game!
