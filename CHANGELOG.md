# Changelog

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
