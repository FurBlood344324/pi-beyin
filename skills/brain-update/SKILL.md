---
name: brain-update
description: Update an existing beyin installation to the new official version, check the version, or roll back a failed upgrade. Use for requests like "beynimi güncelle", "yeni sürüm var mı", "geri dön", "update beyin", "rollback". One tool only — beyin.py update.
---

# Update beyin

Language: write in the user's language and reuse the target file's headings — see `../_shared/project-profile.md` (Language).

The only update tool is `beyin.py` in the vault root. Use `python3` on macOS/Linux and `py -3` on Windows. Don't
update the user's vault with your own curl/copy/git-pull chain.

- If the user only asks about the version, run `python3 beyin.py update --check --metadata-only`; don't install.
- If the user wants the update, run `python3 beyin.py update`. This request authorizes a routine local update;
  don't ask for permission a second time. The official stable release is the default; a preview or a custom package
  is used only if the user chose it.
- If the user wants to go back, run `python3 beyin.py rollback` and then verify the result with `doctor`.
- To silence or re-enable starter skills, adapters or launchers run
  `python3 beyin.py preferences --exclude-component <name>` or `--include-component <name>` (the setting is written
  to `.beyin-exclusions.json` and applied on the next update or install). During an update, excluded files that
  were never modified are cleaned up; files the user changed are preserved.

The same version being a no-op is a success. Success is only claimed from reading back the version and the health.
If the operation is half-finished, the download failed, the package is broken or local files conflict, preserve the
existing information; don't change the version stamp by hand. Don't force past a conflict or restore personal notes
from a backup in bulk. If there is no new release or no access, don't say "updated".

The updater checks the package source, its integrity and the system files it may change. Notes, user skills and
personal settings are not part of the update text. If a new or unusual hook definition needs a trust review, explain
that in the way the client expects; don't invent a trust record. Say what restart is needed and, if any, the single
user step.

In the result message give the previous→new version, the verification result and any step left open. Don't share
tokens, local user paths, personal settings dumps or raw logs.

If `--metadata-only` is not recognized (older beyin), fall back to the existing `update --check`. Version
notifications are an on-by-default daily GitHub metadata check; they post no notes. Apply an off/on request with
`preferences --update-notifications off/on`. To silence one version use `update --dismiss X.Y.Z`. A metadata-only
result is not proof that the package can be installed.
