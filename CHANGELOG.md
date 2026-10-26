# Changelog

## 0.1.17

- New `extensions/compact.ts`: a **working context budget** (240k by default) below pi's own threshold,
  which fires far later on a 1M-token window. When the budget is crossed, Jev is asked one timing
  question (safe now? boundary/mid-task/idle? how stale?) and may postpone at most `deferMax` times.
  Jev can postpone; it can never force an early compaction, and when it cannot answer the extension
  compacts (fail-safe). `/compact-status`, `/compact-now`.
- The summary is still pi's own compaction (iterative chain, file tracking, split turns, overflow retry);
  this extension only adds focus via `customInstructions` and never re-implements the summarizer.
- Any compaction — ours, pi's threshold, overflow recovery, `/compact` — spools its summary to
  `<vault>/.pi/compaction/<ts>-<sid>.md` marked `derived: true`. The directory is a dot-directory, so the
  vault indexer skips it: a model-written summary can never return as verified knowledge.
- Every decision is logged as JSONL to `~/.config/beyin/compact.log` (digest included), so the timing
  question can be answered from data. `"jev": "off"` gives a purely mechanical budget as a comparison arm.
- Config: `compact` block in `pi-hook.json`; env `BEYIN_COMPACT*`. Defaults work with no configuration.

## 0.1.16

- `/damitma` → `/distillation`. No Turkish command name is left; the old one is not aliased.
- Distillation is applied **automatically** outside the vault: the agent runs `beyin.py sync`, writes or
  updates the knowledge note, adds it to the receipt refs and syncs again, without asking for approval.
  Inside the vault the approval flow stays. `BEYIN_DISTILLATION_MODE=offer` restores it everywhere.
- Debug messages in this extension are English.

## 0.1.15

- Configuration names are English: `distillation.json`, `injectionOnly.<project>.distillation`,
  `BEYIN_DISTILLATION` / `BEYIN_DISTILLATION_CONFIG`. The Turkish names (`damitma.json`, `damitma`,
  `BEYIN_DAMITMA*`) are still read, so existing configs keep working; the current name wins when both exist.
- The local config was migrated in place; the `/damitma` command stays as the user-facing trigger.

## 0.1.14

- Rename `extensions/damitma.ts` → `extensions/distillation.ts` (and its test). The pi entry label
  follows the file name, so this is the label users see.
- Unchanged on purpose: the `/damitma` command, `BEYIN_DAMITMA*` env vars, `damitma.json` and the
  `injectionOnly.<project>.damitma` key — those are the configuration contract, not naming.

## 0.1.13

- No project-specific content in the package: the `/jev-test` self-test payload and the live-test mock
  are neutral examples, temp fixtures use neutral names, and the vault query comes from
  `BEYIN_TEST_QUERY` (checks are skipped when it is unset).

## 0.1.12

- README rewritten for the current layout (quick start, verification, scope, privacy, release).
- Add `CHANGELOG.md` and `SECURITY.md`.

## 0.1.11

- `BEYIN_LANG=en` now also covers the injected context header, the `beyin_jev_*` tool schema and the
  Jev scoring instruction/criteria. Default stays Turkish.
- `test/test-skills.ts`: skill inventory, `name:` matching the directory, description budget, no
  personal paths, `_shared/` references, `pi.skills` manifest. Wired into CI and `run.sh`.
- `run.sh` warns when the vault's `.agents/skills` duplicates a package skill.
- Test labels and the live-test narration are English; assertions on product text are unchanged.

## 0.1.10

- English comments and dev output in the CI workflows and the test scripts.
- `e2e.sh` assertions accept both language builds.

## 0.1.9

- `BEYIN_LANG` (`tr` default, `en`) for the receipt reminder, the distillation offer and the two command
  descriptions.
- README: who this is for, the CommandCode provider recommendation, and what the harness patch does on an
  unfamiliar vault.

## 0.1.8

- Remove version branding from the README, code comments and skills.
- `THIRD-PARTY-NOTICES.md` for the MIT source excerpts embedded in the harness patch.

## 0.1.7

- English comments in `tools/pi-harness-patch.py`; private log references replaced by dates.
- README documents the split between the vault and the pi adapter.

## 0.1.6

- Trim skill trigger lists to three distinctive phrases per language (total description size −28%) and
  document the bilingual routing surface.

## 0.1.5

- English names for the workflow skills (`brain`, `brain-doctor`, `brain-update`).

## 0.1.4

- Ship the beyin workflow skills (`brain*`, `source-distillation`) and the language-neutral output rule.

## 0.1.3

- English skill directories and names; declare `pi.skills` in the manifest (a manifest with only
  `extensions` makes pi load no package skills).

## 0.1.2

- Publish pipeline smoke test (trusted publishing, provenance).

## 0.1.1

- English comments; package-local harness patch; no personal project default in `DEFAULT_EXCLUDES`.

## 0.1.0

- First release: `context`, `damitma` and `jev` as one package, tests, `v0.1.0`.
