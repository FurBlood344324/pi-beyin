---
name: bakim
description: System maintenance / garbage-collection PROPOSAL procedure. Use for requests like "temizlik", "bakım", "sistemi toparla", "çöplükleri temizle", "clean up", "tidy the repo", "oturumu kapat", "yeni oturuma geçmeden temizle", "kompakte et", "compact the state". Also PROPOSE maintenance to the user at natural moments such as session close or phase transition. IMPORTANT — never runs on its own or on a schedule; it only proposes, and acts after user approval. Paths come from the project profile.
---

# Maintenance — Garbage Collection PROPOSAL (runs on approval)

## Paths
`<project root>/.pi/beyin-project.json` → `logs`, `log_index`, `state`, `progress`, `journal`, `scopes`,
`close_steps` (idempotent/derived commands run at close — see `../_ortak/proje-profili.md`).
No profile → default `logs/`, `journal/`.

## Core rule: PROPOSE, don't run
- Maintenance **never runs on its own or on a schedule.**
- It only **proposes** at the right moment: "I can clean these up, shall I?"
- **No file is changed or deleted without user approval.** No approval → don't touch it.

## When to propose
- Session close ("that's it for today", "continue tomorrow", "new session").
- Phase/milestone transition.
- User says "cleanup/maintenance/garbage".
- The proposal must be **single and concrete**: list what will be cleaned, then wait for approval.

## Proposal template
> "Maintenance proposal (I'll do it if you approve):
> 1. Shorten `<state>` / move history leaked into `<progress>` into the logs.
> 2. Remove unneeded `.gitkeep`.
> 3. Stale-reference scan.
> Shall I?"

## Garbage types and action (AFTER approval)
| Garbage | Symptom | Action |
|---|---|---|
| Duplicated info | Same content in 2+ files | Keep one **source**; reference it from the other |
| Growing list | `progress`/`index` bloating | Compact; detail lives in the log → reduce to a number |
| Stale info | Old date/phase name | Fix or remove; `progress` is the single truth |
| Dead/empty file | Functionless `.gitkeep` | Delete |
| Orphan reference | File/log that doesn't exist | Fix or remove |
| Missing scope | Log/template has no `Scope` (when profile has `scopes`) | Add it |

## Procedure (maintenance work only after approval; `close_steps` are pre-approved via profile)
1. **Journal flush:** is today's journal entry written? (see `../gunluk/SKILL.md`)
   **Compile flush (informational):** any day present in the profile's `journal` (raw) with no counterpart
   in `journal_derived` (compiled)? If so, **tell the user briefly**; compiling is **manual** and is not
   produced here.
2. **Close steps (`close_steps`):** if defined in the profile, **run** them (from the project root;
   idempotent + derived-only → no approval needed) and report output in one line. Skip if undefined.
3. **Index:** does the log index contain the highest number (and `Scope` if used)?
4. **State layer:** is `state` short (≤ ~1 screen), has history leaked into `progress`?
5. **Stale scan:** are fixed phase names only in `progress`?
6. **Orphan references:** verify paths with `ls`.
7. **Dead files:** `find <dir> -type f -empty`.
8. **Scope:** does every log have `Scope:` (when profile has `scopes`)?
9. **One-line report.**

## Rules (safety)
- **AGENT DELETE BAN:** the agent does **not** run `rm`/`mv`/overwrites **on its own decision** — even during
  maintenance. Flow: **proposal list → user approval → single command.** No unapproved exception.
  **Exception:** `close_steps` (pre-approved by the profile, idempotent/derived-producing) run directly — but
  confirm from the profile that the command contains no delete/move; if in doubt, **don't run, ask**.
- **Inventory before destructive commands:** list what will be deleted/moved first (`ls`, `du -sh`, `find`)
  and show it to the user. `rm -rf <wide root>` is forbidden → narrowest path + single target.
- **NO ARCHIVE — keep or delete (user, 2026-10-12/log 0092):** unused scripts/artifacts are **not** parked in
  zombie folders like `_archive/`, `_old/`, `bak/` (confusion + dual ownership). If not needed, **delete it**;
  "might be useful later" is not a valid reason — if it stays, write the **one-line why**.
- **No data loss (the distinction):** for **source data** (raw data, sets carrying human labelling effort) what
  is deleted **must be recorded elsewhere**. **Derived / reproducible** output (scripts, throwaway runs,
  intermediate files) may be deleted on that basis; if unsure, don't guess — **ask**.
- **No heavy work for verification:** `--help`, reading sources/docs, `grep`, `--dry-run` are enough.
- **If an accident happens:** report immediately; check recovery options (git/copy) in the same turn; record
  the lesson.
- **Frontmatter YAML:** don't use `: ` (colon+space) inside `description`; prefer `—` or `=`.
