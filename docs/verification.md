# Verification

Publication verification passed 85 offline tests and syntax checks for 43 modules; the pinned 陪练 checksum matched. Gitleaks 8.30.1 found no secrets in the publication tree.

The suite runs offline on Node 22 or newer. Run `npm test` and `npm run check`; CI uses Node 24 and also scans public Git history with Gitleaks.

## Core and providers

Tests cover all 108 physical identities, trump/level combinations, explicit pair/tractor/follow examples, hundreds of generated reference comparisons, complete practice deals, level progression, redeals and private observations. Provider fixtures cover all three wire formats, legal tool selection, malformed/multiple/truncated calls, the shared 12-second deadline, preserved 陪练 fallback and late-usage reconciliation.

Continuous dealing tests check that private bidding cannot stop draws or reveal eligibility through public state or SSE cadence. First legal bids win, stale weaker bids are superseded, and only accepted bids renew the five-second closing window.

## Own-key connections and restart

Tests cover independent browser cookies and CSRF tokens, unconfigured server-wide keys being ignored, credential-free state/checkpoints, key expiry and restart, custom models/prices, private/reserved/mapped endpoint rejection, DNS-pinned sockets, no redirects and malicious provider responses echoing credentials. A real local HTTP provider fixture validates transport and metering without a paid model call.

Restart changes game identity and resets levels while keeping previous accounting. Late actions cannot affect the new game; late tokens update the old table. Next-deal progression keeps its existing rules. Broken saves and invalid numeric settings fail before replacing the current game.

## Browser checks

Playwright verifies manual play, mixed seats, a complete deal, keyboard/pair selection, narrow layouts, last-trick review, four collection directions, long card groups, zero-point winners, reduced motion, WebGL fallback, pause/reconnect and handoff privacy. The sticky rule bar retains the played level after scoring and remains visible while scrolling the hand.

The next-deal button was exercised from a completed fixture, preserving match identity while starting a new deal.

The own-key dialog is exercised through saving a fixture key, assigning a custom model to seats, canceling and confirming restart, and clearing keys. Checks assert an empty key input after save, no key in localStorage or API responses, and a cookie inaccessible to JavaScript. Fixtures remain under ignored `output/playwright/`; private user games, account exports and historical billing records are not publication artifacts.

The publication pass runs no paid model calls. A protocol fixture or fallback-assisted match does not establish model strength. Provider bills, model entitlements, physical-device touch feel and deployment capacity require their own validation.
