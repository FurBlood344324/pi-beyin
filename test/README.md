# Test suite

Tests for the three extensions in `extensions/` (`context`, `distillation`, `jev`).

## Running

```bash
bash run.sh                 # model-free: harness + unit/integration (fast)
BEYIN_LIVE=1 bash run.sh    # + one real CommandCode call
BEYIN_E2E=1 bash run.sh     # + a real pi session (model calls)
bash run.sh <project-dir>   # + multi-turn Jev scenario in that project
```

The Jev scenario test (directory-based, multi-turn):

```bash
bash run.sh ~/projects/example
BEYIN_SCENE_DIR=~/projects/example BEYIN_SCENE_TURNS=3 bash run.sh
bun run test-jev-scenario.ts ~/projects/example 3
```

Individual tests:

```bash
bun run test-distillation.ts
bun run test-context.ts
bun run test-jev.ts
BEYIN_LIVE=1 bun run test-jev-live.ts
bash e2e.sh
```

Steps 1–3 of `run.sh` read a live vault; everything else is self-contained. The context query comes from
`BEYIN_TEST_QUERY` (no project phrase ships in the repo); without it those checks are skipped.

## Coverage

| File | Covers |
|---|---|
| `test-distillation.ts` | Offer conditions (memory written, no `knowledge/`), suppression (vault/excluded project/aborted/cooldown), isolated hook config (`excludeProjects` + `injectionOnly.distillation`, legacy `damitma` key covered), `/damitma` |
| `test-context.ts` | Real `beyin.py context` injection, skip conditions, receipt reminder → system prompt section, Jev cache filter + fail-open |
| `test-jev.ts` | Provider registration, JSON parsing/normalization (choice/score/bool), error paths (key/HTTP/abort), `/jev-test` |
| `test-advisor.ts` | Advisor tools (`beyin_jev_review/answer/memory`), silent-mode gate, JSON stdin bridge (local validation errors only, no remote calls) |
| `test-jev-live.ts` | Real CommandCode round trip (only with `BEYIN_LIVE=1`) |
| `e2e.sh` | Real pi session: context injection + reminder (only with `BEYIN_E2E=1`) |
| `test-jev-scenario.ts` | **In a given directory**, real pi, multi-turn: injection + Jev background scoring completing (abort/timeout regression) |
| `run.sh` | All of the above + the pi-harness patch |

## Notes

- `harness.ts` imitates the pi extension API; the real `beyin.py` commands run.
- **Config isolation:** tests never read the live `~/.config/beyin/*.json`. Each run creates its own
  temporary directory (`fixtures.ts`) and generates hook/distillation/jev configs from the paths it was
  given — no pinned user paths, so CI behaves the same as a laptop.
  (2026-10-17: a test that depended on the live `pi-hook.json` went stale when that file changed.)
- Jev tests load a fresh module instance via `?fresh=N`. Cache-busting requires an **absolute path**:
  Bun ignores the query string on `file://` URLs and returns the cached module (measured).
- Tests do not write to the vault; they only call read-only `context`/`doctor`.
- `[beyin]` / `[beyin-distillation]` / `[beyin-jev]` lines in the output are `BEYIN_DEBUG=1` diagnostics.
