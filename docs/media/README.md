# Media provenance and recording

The current media show **Eighty 0.3.0's arcade renderer and project artwork**. Earlier captures are retained separately in the list below. There are no old-table or hand-lab pages in the release.

| File | Use |
| --- | --- |
| `arcade-menu-zh.png`, `arcade-menu-en.png` | Current Chinese/English main-menu screenshots with the live ink background. |
| `arcade-gameplay-zh.gif`, `arcade-gameplay-en.gif` | Current Chinese/English recordings: hover, selected-tractor dragging, card landings and public trick/score effects. |
| `arcade-gameplay.mp4`, `arcade-gameplay-en.mp4` | Clearer Chinese/English video versions of the arcade gameplay. |
| `arcade-table.png` | Actual full-table screenshot with the arcade finish. |
| `cards.png` | A presentation of actual `card-art.js` / `card-glyphs.js` cards and the project atlas. |

The arcade clips use an isolated, reproducible post-deal fixture with one human, local practice opponents and an offline simulated API partner. Paid API allowance is zero. Clips are trimmed and encoded for documentation; actions, card motion, effects and outcomes come from the actual game. They contain no audio and no composited gameplay. The card sheet is a promotional composition, not another game interface.

The README GIFs use a reduced export resolution and frame rate to fit the repository's media budget. The MP4 files preserve clearer motion. These export choices are not the game's animation rate or a device performance guarantee.

## Earlier captures

| File | Historical use |
| --- | --- |
| `menu-zh.png`, `menu-en.png` | Main-menu captures from the 0.2.0 pixel-table release. |
| `gameplay-zh.gif`, `gameplay-en.gif` | Twelve-second, 15 fps recordings of hover, selection, a single-card drag and trick collection in 0.2.0. |
| `group-drag.gif` | The selected-pair gesture before arcade effects: cancel once, then play both cards; about eleven seconds at 20 fps. |
| `social-card.png` | Original 1200×630 sharing composition using the real wordmark and cards. |
| `../images/table.png` | The earlier full-table screenshot. |

These earlier clips use local practice bots and no paid requests; some have a small cursor highlight to clarify the gesture. They remain intact as the record of the earlier appearance. Current publication pages use the arcade media above.

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
