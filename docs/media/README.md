# Media provenance and recording

These files show **Eighty's current renderer and project artwork**. There are no old-table or hand-lab pages in the release.

| File | Use |
| --- | --- |
| `menu-zh.png`, `menu-en.png` | Actual Chinese/English main-menu screenshots. |
| `gameplay-zh.gif`, `gameplay-en.gif` | Real manual hover, pair selection, one-card drag, local-bot replies and trick animation. |
| `group-drag.gif` | Select a pair, drag the first selected card, cancel and return, then drag the second selected card to play both. |
| `cards.png` | A presentation of actual `card-art.js` / `card-glyphs.js` cards and the project atlas. |
| `social-card.png` | 1200×630 sharing image using the real wordmark and card components. |
| `../images/table.png` | Actual full-table screenshot. |

The gameplay clips use an isolated, reproducible post-deal fixture with one human and three local practice bots. API allowance is zero. The clips are trimmed and encoded for documentation; a small cursor highlight is added to clarify pointer movement. Game actions, card motion and outcomes come from the actual game. The card sheet and social card are promotional compositions, not additional game interfaces.

The group-drag follow-up is approximately eleven seconds at 20 fps; the original gameplay GIFs are twelve seconds at 15 fps. The GIF frame rate is an export choice, not the game's animation rate.

Project media is distributed under [Apache-2.0](../../LICENSE), with [NOTICE](../../NOTICE) and [credits](../credits.md). Link back to the repository when sharing. No official Balatro assets are included.

## Make a fresh recording

Start an isolated media table:

```sh
npm run media:preview
```

It uses the normal `public/index.html` renderer at port 5191 and writes a synthetic fixture plus cookie metadata under ignored `output/media-preview/`. It never loads `.env` or makes an API call. Import the generated cookie into your recording browser to resume that fixture; a fresh ordinary browser can instead start a normal practice game. Stop the preview with Ctrl-C. Keep the regular game at port 5173 separate.

`MEDIA_PORT` can choose another preview port. To produce a new fixture for the already-running preview server:

```sh
node scripts/media-preview.mjs --fixture-only
```

Capture with a browser recorder. One optional tool is Playwright CLI:

```sh
npx @playwright/cli -s=eighty-media open http://127.0.0.1:5191
npx @playwright/cli -s=eighty-media video-start output/gameplay.webm --size=1440x960
# Play the real game, then stop recording.
npx @playwright/cli -s=eighty-media video-stop
```

For an interactively visible browser, add `--headed` to `open`. Use anonymous local-practice seats, keep private connection settings out of frame, and review the entire clip. Use the same source assets for artwork sheets; do not generate screenshots of functionality the game does not implement.

An example GIF encoding command with FFmpeg:

```sh
ffmpeg -ss 0.4 -t 12 -i output/gameplay.webm \
  -filter_complex '[0:v]fps=15,scale=960:-1:flags=lanczos,hqdn3d=1.5:1.5:3:3,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle' \
  -gifflags +transdiff -loop 0 docs/media/gameplay.gif
```

Keep each published asset below 6 MiB; `npm run check` checks this limit and local documentation links. Keep raw recordings, browser profiles and capture scripts under ignored `output/`, not in the release.
