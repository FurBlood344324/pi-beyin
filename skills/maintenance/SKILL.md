---
name: maintenance
description: System maintenance / garbage-collection PROPOSAL procedure. Use for requests like "temizlik", "sistemi toparla", "kompakte et", "clean up", "compact the state". Also propose maintenance at natural moments such as session close. IMPORTANT: never runs on its own or on a schedule; it only proposes, and acts after user approval. Paths from the project profile.
---

# Maintenance - Garbage Collection PROPOSAL (runs on approval)

Language: write in the user's language and reuse the target file's headings; see
`../_shared/project-profile.md` (Language).

## Paths
`<project>/.pi/beyin-project.json` gives `logs`, `log_index`, `state`, `progress`, `journal`, `scopes`, `secret_dirs` and `close_steps` (pre-approved, idempotent, derived-only).

## Core rule: PROPOSE, don't run
- Maintenance never runs on its own or on a schedule; it proposes at the right moment.
- No file is changed or deleted without approval. No approval, no touch.
- The scans only report; `close_steps` are the one pre-approved part.

## Command
`tools/maint-scan` in this package, two levels above this skill's directory. It walks up from the
cwd to the profile, so any project subdirectory works. Which finding deserves a proposal is the
judgement here, not the scan.

    maint-scan close      run close_steps, one verdict per step (delete or move is refused)
    maint-scan orphans    backticked paths in state/progress/index that do not exist
    maint-scan empty      empty files, secret_dirs skipped
    maint-scan index      rows missing, stale rows, records without Scope
    maint-scan all        the three scans in one pass, then one verdict line

## When to propose
- Session close, phase/milestone transition, or "cleanup / maintenance / garbage".
- At session close, is today's journal entry written? (see `../journal/SKILL.md`)
- Single and concrete: list what will be cleaned, then wait for approval.

## Proposal template
> "Maintenance proposal (I'll do it if you approve):
> 1. Shorten `<state>`, move leaked history into the logs.
> 2. Remove the empty `.gitkeep` in `<logs>/`.
> 3. Fix the two dead references from `maint-scan orphans`.
> Shall I?"

## Garbage types (after approval)
| Garbage | Symptom | Action |
|---|---|---|
| Duplicated info | Same content in 2+ files | Keep one source, reference it from the other |
| Growing list | `progress`/index bloating | Keep the number, detail lives in the log |
| Stale info | Old date or phase name | Fix or remove; `progress` is the truth |
| Dead file | Functionless `.gitkeep` | Delete |
| Orphan reference | File or log that does not exist | Fix or remove |
| Missing scope | No `Scope` when the profile has `scopes` | Add it |

## Safety
- Flow: proposal, approval, single command; a `close_steps` entry that deletes or moves is not run.
- Inventory before a destructive command; narrowest path; `rm -rf <wide root>` forbidden.
- No archive folders, and source data deleted must be recorded elsewhere.
