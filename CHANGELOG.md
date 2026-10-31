# Changelog

## 0.2.1

- `extensions/context.ts`: context injection now asks Jev **which note, or none** instead of rating every
  retrieved record on its own scale, and **stays silent** when nothing fits. Shape: one `choice` over the
  candidates plus an explicit `none` and a topical `noul` gate, then a yes/no per note for the candidates
  that can still pass, then `sqrt(group probability * confirm)` against a floor — ported from the
  beyin-recall layer (https://github.com/erentaskiran/beyin-recall). The policy lives in
  `tools/jev-pick.py`, one implementation shared with measurement; the extension no longer needs the
  classifier registry, only Python + the vault's Jev key.
- Candidate pool: 12 records / 30000 chars (whole notes, so the judge gets a 450-char window of the part
  that matches), the last two prompts are added to the query (follow-ups share no words with the note they
  need), and companion / `knowledge/v3` / `daily` / `receipts` / `journal` / `AGENTS.md` records are never
  candidates. A note delivered in a session is not repeated.
- Measured on 36 real prompts (21 needing a note, 15 that should stay silent): pool-then-inject-everything
  hit 11/21 with 15/15 noise turns and 4% precision, 281 notes delivered. The judged path: 6/21 hit, 3
  wrong, 7/15 noise, 32% precision, 19 notes. The judge buys precision and silence, not recall; a "maybe"
  line was tried and added 6 lines with zero new hits, so it stays off.
- Fail-closed replaces fail-open on this path: no answer (key, timeout, crash) means no injected context
  instead of an unjudged pool. `mode: "shadow"` still delivers the pool for measurement, `BEYIN_JEV=0`
  restores the old behaviour for a session.
- Tests: `test/test-context.ts` drives a stubbed `tools/jev-pick.py` (deliver, silence, error, shadow, pool
  hygiene), new `test/jev-pick-selftest.py` pins the policy floors (10 model-free checks), wired into
  `test/run.sh`.

## 0.2.0

- New `extensions/batch.ts`: a **serial-tool-call nudge**. A tool call alone in an assistant message
  costs a full turn, and measurement over ten days of a real vault put 76% of 13,761 calls in such
  single-call chains (mean 10.5 steps, longest 249) with only 12% of tool messages carrying two or more
  calls. When the last three completed turns each had exactly one call and one tool repeats three times,
  the extension sends a one-line note: put independent calls in one message, put dependent or filtered
  chains in one `codemode` script, stay serial when there is judgement between steps.
- The note travels as `sendMessage(…, { triggerTurn: false })` with `display: false`: it never starts a
  turn of its own and never annotates a tool result, because `read`/`write`/`edit` content is file text.
- Deliberately quiet: mixed tools in sequence, parallel turns, nested calls (`parentToolCallId`), a
  cooldown of eight turns, and a six-note session cap all stay silent; `BEYIN_BATCH="0"` (legacy
  `SERIAL_NUDGE_OFF="1"`) or `BEYIN_DISABLE="1"` turns it off. Per-registration state, so two sessions in
  one process never share a chain counter.
- Tests: `test/test-batch.ts` (23 model-free checks) added to CI and to `test/run.sh`.

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
