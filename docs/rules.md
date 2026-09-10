# Implemented Shanghai rules

Status: implemented local profile `shanghai-80fen-0.7.14-v1`. The reference implementation defines this initial rule profile. Reference: [ChannonTian/80fen at 96f6925](https://github.com/ChannonTian/80fen/blob/96f69258b68495904f360a199738b161da4f4998/docs/RULES.md). This identifies one implemented profile, rather than claiming every Shanghai table plays identically.

## Cards and teams

Exactly four seats: south 0, east 1, north 2, west 3. Opposite seats partner: 0/2 against 1/3. Each seat independently selects human, preserved 陪练, or API provider. Two decks give 108 distinct physical cards, 25 per seat and eight in the kitty. 5 is five points; 10 and K are ten points; the decks contain 200 face points.

Each physical card ID has one fixed printed suit and rank. Conservation checks verify all 108 distinct identities and their faces, including when restoring a checkpoint; a forged face with an otherwise unique ID is invalid.

## Declaration and deal sequence

The browser uses [continuous dealing](continuous-dealing.md) for zero or one human. The card-rule profile stays the same; the chosen timing mode is recorded separately as `dealing`. Shared-device multi-human play retains ordered mode for handoff privacy.

New browser matches use `firstDealer=random`: an independent seeded cut chooses the first dealer before dealing, so either partnership may attack first. Declarations choose trump without changing that dealer. Core reference fixtures and older checkpoints can explicitly retain `firstDealer=declaration`.

A separate cut determines the first taker in a game without a known dealer. Otherwise the dealer takes first. Deal 100 cards in seat order. A seat can use only its already received cards. One level card declares that suit; a matching level pair is stronger; small-joker and big-joker pairs can declare no-trump. A stronger declaration can counter another seat. Self-countering is prohibited; the current declarer can reinforce its single into a same-suit level pair before a joker-pair counter.

Continuous mode deals one card every 500ms by default (700ms is optional). Any player can submit a legal bid using received cards while dealing continues. API requests are private and concurrent, at most one per seat. A proposal must have been available in its original observation and remain legal on receipt. A later equal-strength bid is silently discarded; it is never upgraded or replaced automatically. After card 100, a shared five-second closing window opens. Actual accepted bids renew that full window; private thinking, passes and failures do not. No more cards are drawn during closing.

Ordered mode is retained for existing checkpoints, historical provider fixtures, and multiple humans sharing one screen. In that mode, the receiving seat gets an ordered opportunity after its draw, and logical dealing waits for a non-pass choice. Closing uses a complete pass lap, capped at four laps. It is not the default single-human experience.

No declaration means no-trump. A known dealer remains dealer after counters. Without a known dealer, the last declarer becomes dealer, or the first taker if nobody declared. Dealer receives the kitty and buries exactly eight cards, without point or trump restrictions.

Optional low-point/low-trump redeals default off. When enabled, opposing-team seats with at most 15 points or at most three trumps can request a redeal. There are at most three redeals in a deal. The setup offers a simple redeal or a redeal with a fresh dealer contest. This follows the seat-independent eligibility of the reference referee. During a fresh dealer contest, each team bids its own level; the public `dealerKnown` flag distinguishes that contest from the previous match dealer.

## Card order and following

Jokers, every level-rank card, and the trump suit form effective suit T. Within T: big joker > small joker > trump-suit level > off-suit level > ordinary trump-suit ranks. Without a trump suit, all level cards tie below the small joker. Ordinary ranks skip the current level.

A pair has identical printed suit and rank. A tractor contains consecutive ordered pairs. At level 7, heart 6/6 followed by 8/8 is consecutive. At level 2 that combination is not a tractor. Equal-ranked off-suit level pairs occupy separate layers; an extra equal-order pair cannot split an otherwise valid chain.

Follow the lead's card count. Follow as many cards of the effective led suit as possible, with available pairs required up to the lead's pair count. A tractor lead additionally requires a matching-length tractor if available, or the longest available shorter tractor when partial following is enabled. Both strict and partial following default on; partial following can be switched off at setup.

Only plays whose component structure matches the lead can contend for a trick. Matching trumps beat side suits; within the winning suit, the higher top order wins. Equal order belongs to the earlier play. These comparison semantics follow the reference implementation.

## Throws, scoring, and progression

A lead can throw several components from one effective suit. If any other player, including the partner, can beat a component within that suit, the attempt is adjudicated to the component with the lowest top order. There is no point fine. Mixed-effective-suit leads are invalid. Invalid client/model proposals are rejected before mutation; they are different from an adjudicated failed throw.

Attackers need 80 points to take over. If attackers win the final trick, add kitty points multiplied by twice the last lead's card count. Dealer-team wins advance three levels at zero, two below 40, and one from 40 through 75. Attackers take over at 80, advancing floor((score - 80) / 40) levels. Thus 80 through 115 changes dealer with no level gain.

After the dealer team wins, its partner deals next. When attackers take over, the previous dealer's next seat deals. Default mandatory levels are 2, 5, 10, K: crossing a gate stops at it, and a team must successfully defend its current gate before passing it. Passing A wins the match. A deal ends when hands are empty, not after a fixed 25 tricks.

Optional speed mode uses 2 → 5 → 10 → K → A and at most one step per winning level gain; mandatory gate checks are disabled in this mode. It does not guarantee a fixed number of deals because zero-level takeovers and changing winners remain possible.

## Verification

`test/engine.test.js` contains explicit card, tractor, following, throw, scoring, and gate examples; comparisons against the pinned reference; card conservation across complete practice deals; and a multi-deal match. These tests verify implemented behavior. New disputed rules should become explicit examples before changing the engine.
