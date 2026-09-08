# Optional live API evaluations

Normal tests are offline. Real provider experiments require an explicit `--live` flag and credentials supplied by the person running the experiment. Never commit keys, raw account exports, request IDs or private run files.

The CLI evaluators load an ignored `.env`; these values are not shared with web sessions. Set a compatible `QWEN_API_KEY`, `QWEN_BASE_URL` and optional `EVAL_MODEL` for a local experiment. Without `--live`, the scripts make no model requests.

- `node scripts/live-eval.mjs`: bounded declaration, burial and follow fixtures.
- `node scripts/live-deal.mjs`: a bounded single-deal evaluator, with explicit resume support.
- `node scripts/live-model-catalog.mjs`: bounded model tool-call probes.

Read each script's request, token and time limits before enabling a paid run. Reports go to ignored `data/evaluations/`. Keep model actions, repairs, forced actions and fallback separate. Missing usage remains unknown; a timeout is not proof of zero cost. Estimate known tokens using the configured reference rate, then reconcile with the provider's own bill.

For playing-strength claims, use paired deals and seat/team rotation, report uncertainty, and keep held-out scenarios. A completed integration test is not a strength benchmark. Publish only anonymized aggregate results and reproducible fixtures.
