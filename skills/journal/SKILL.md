---
name: journal
description: Daily journal (raw narrative) recording procedure. Use for requests like "günlük", "bugün ne yaptık", "günlüğe ekle", "bugünü kaydet", "gün sonu", "oturumu yaz", "dün ne yapmıştık", "günlüklerime bak", "journal this", "log today", "what did we do yesterday". Detects the system date, opens `YYYY-MM-DD.md` in the journal directory (creating it if absent) and adds what was done that day — including work done through conversation — as prose. The journal is the raw narrative layer; reports/summaries are derived from it. Path and scope come from the project profile.
---

# Journal — Raw Narrative Layer

Language: write in the user's language and reuse the target file's headings — see `../_shared/project-profile.md` (Language).

## Paths (from the project profile)
`<project root>/.pi/beyin-project.json` → `journal` (default `journal/`), `logs`, `state`, `progress`,
`scopes`, `report_dir`. No profile → journal in `journal/`, template `journal/_template.md` (or whatever template file the
project already uses, e.g. `_sablon.md`).
File: `<journal>/YYYY-MM-DD.md` (one file per day). Schema: `../_shared/project-profile.md`.

## Purpose
Keep what was done that day as **prose**. The flowing narrative that makes tomorrow-you say "right, that".
This layer is the **source**; reports/summaries are derived from it.

## Journal ≠ log
| | Journal | Log (`logs/`) |
|---|---|---|
| Language | Prose, flowing | Structured, tabular |
| Scope | The whole day | One experiment/decision |
| Duplication | **References** the log | Complete on its own |
| Purpose | Continuity, report raw material | Reproducibility, evidence |

Rule: **take numbers from the log, don't re-invent them in the journal.** If you write a number, put the
log number next to it.

## Procedure
1. **Date:** `date +%F` and `date +%A`. "yesterday" → `date -d yesterday`; a specific day → use it.
2. **Does the file exist:** if not, create it from the template; if it does, **don't overwrite, append**.
3. **Material:** what was done through conversation this session (the primary source) + logs produced that
   day + state/roadmap changes.
4. Write the **"What we did today"** section in sentences: where we started → what we did → what blocked us
   → how we solved it.
5. **"Left a trace in the system"** → references to logs/progress.
6. Fill **"What I learned"**, **"Next"**, **"Free notes"**.
7. Update the previous/next day links.
8. Give a one-line summary: "journal/YYYY-MM-DD.md updated: <one sentence>".

## Auto-triggering
- End-of-day/session signal ("that's it for today", "continue tomorrow") → update the journal.
- If the profile defines `close_steps` after the journal is written → trigger the `maintenance` skill's close steps
  (idempotent/derived commands run, e.g. refreshing a dated index).
- If a new log was produced that day and no journal entry exists → offer to create it.
- If unsure, ask: "Shall I add today to the journal?"
- Never record silently.

## Rules
- **Gaps are normal (weekend / public holiday):** no work that day → **no** journal file. Don't treat
  weekends and holidays as "missing" and try to fill them, don't create empty files. A file is created only
  for days **actually worked**; consecutive days are not expected (days may be skipped).
- **Scope section:** if the profile defines `scopes`, write infrastructure/system work in a separate section
  such as `## Harness / system (excluded from report)`; the report skips that section.
- **No invention, no inflation.** A wasted day goes into the journal too (valuable data).
- **Keep it short.** 1 day ≈ 1 screen. If it grows, you're repeating the log.
- **Write only to this file.** Log/progress updates are other skills' job; the journal references them.
- The journal is an internal note; the report is the edited derivative.
