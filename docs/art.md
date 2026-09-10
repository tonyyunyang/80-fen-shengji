# The visual table

[Press kit](press-kit.md) · [Credits](credits.md) · [Media files](media/README.md)

Eighty's visual language combines green felt, a curved rail, warm paper, clear suit colors and small pixel characters. The deck and title lettering belong to the same interface used during play.

![Actual card artwork](media/cards.png)

## Source of the artwork

- `public/wordmark.js`: original Chinese and English title shapes, with stepped edges and layered color. These are not a substituted display font.
- `public/card-glyphs.js`: SVG pixel ranks and suits. Suit shape remains meaningful even with the optional four-color palette.
- `public/card-art.js`: assembles indices, pips, court illustrations and jokers.
- `public/assets/cards/pixel-court.webp`: the approved AI-generated 4×4 court/joker/back atlas. Keep this source intact when changing layout.
- `public/pixel-view.js`, `public/pixel.css`: portraits, paper, felt, shadows and table details.

Both 25-card and 33-card hands use the same renderer. Hover moves the painted faces while hit testing stays on stable slots. Court art keeps its proportions; pip fields leave space for both index corners.

## Contributing art

Keep printed rank and suit readable at normal playing size. Check red/black and four-color palettes, duplicated physical cards, selected states, table fans and a narrowed window. Use pictures for the two jokers rather than adding unfamiliar HI/LO labels.

Preserve original source assets, and document provenance and license for additions. New artwork should fit the existing table, not introduce another renderer or demo page. SVG/code-native assets are preferred for glyphs and interface shapes; bitmap illustrations belong in the atlas or a reviewed replacement.

[Balatro](https://www.playbalatro.com/) is an inspiration for the pixel-card mood, not an affiliation. Project-generated art and code are covered by [the project license](../LICENSE); third-party trademarks and official assets are not granted by it.
