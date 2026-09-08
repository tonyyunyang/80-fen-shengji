# Preserved 陪练

The unmodified first script block of ChannonTian/80fen index.html at commit 96f69258b68495904f360a199738b161da4f4998 is retained in reference-core.cjs under its original Apache 2.0 license. It includes the strategy's private rule helpers. Provenance and SHA-256 checksums are in provenance.json.

The independent application engine is src/game.js and src/rules.js. It does not import this module. src/peilian.js is the only runtime adapter that imports the original core. Tests may use it as an additional comparison oracle.

The adapter preserves strategy defaults and browser declaration/redeal probabilities. It supplies an independent decision random stream, supports every seat, and uses the new controller's ordered declaration schedule. These differences from the original browser timing are intentional. Strategy equivalence is tested on fixed observations; exact match results are not promised.

Reimport only the pinned source with npm run import:peilian. Changing the pin requires reviewing provenance and running comparison tests.
