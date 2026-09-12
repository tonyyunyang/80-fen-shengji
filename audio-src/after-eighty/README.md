# After Eighty · 八十分之后

An original listening draft for Eighty, composed September 12, 2026.

The direction is a warm, hazy card room: electric tine keys, a rounded bass,
a sparse bell melody, stereo pads and light brushed percussion. The notes,
arrangement and instrument synthesis are authored for this project. Balatro
is a mood reference; its recordings, musical phrases and sound files are not
inputs to this renderer.

- B minor, 86 BPM, 4/4, 32 bars, approximately 89 seconds.
- Four phrases vary the melody and accompaniment. The third leaves more space.
- Sustained notes, room tails and delays wrap around the PCM loop boundary.
- A separate 13-second audition contains original deal, play, tractor,
  point-collection, threshold and round-win cues.

This is a listening draft. It is separate from the production soundtrack and
the current `public/table-sound.js`; integration follows selection of the
musical direction. Earlier audio code is preserved in the dated
`output/audio-design/before-*/` backup. No game rules or AI behavior changes.

## Reproduce

Use Python 3.9+ with the pinned build-only libraries in `requirements.txt`,
plus FFmpeg on PATH. These are not game runtime dependencies.

```sh
python3 -m venv output/audio-design/venv
output/audio-design/venv/bin/python -m pip install -r audio-src/after-eighty/requirements.txt
output/audio-design/venv/bin/python audio-src/after-eighty/render.py
```

Outputs go to ignored `output/audio-design/after-eighty-v1/`: a 24-bit stereo
PCM loop master, a full MP3, a 36-second faded listening preview, a sound-effect
audition, a note-event list and a checksum manifest. The renderer uses a fixed
random seed for repeatable note variation and synthesis.

The MP3s are for listening review; the PCM master retains the precise loop
length for eventual game integration. Technical checks cover finite samples,
headroom and the wrap boundary. Musical balance still needs listening review.
