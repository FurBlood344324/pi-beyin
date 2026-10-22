---
name: brain-doctor
description: Health check for the beyin installation — does memory actually work, are sources indexed, are hook/worker, skills and updates healthy. Use for requests like "beyin doktor", "hafıza çalışıyor mu", "sağlık kontrolü", "doctor çalıştır", "neden hatırlamıyor", "hook çalışmıyor", "skill çakışması", "run a health check", "is the memory working", "why doesn't it remember", "check the hook". Never turns an indicator green by deleting data.
---

# Beyin doctor

Language: write in the user's language and reuse the target file's headings — see `../_shared/project-profile.md` (Language).

Work with `beyin.py` in the vault root. macOS/Linux: `python3 beyin.py doctor`; Windows: `py -3 beyin.py doctor`.
Don't copy old Bash hook lists or another user's paths.

Read the version, pending/failed jobs, the last sync, source conflicts and skill status from the output. Even when
the command exits 0, don't read an empty lifecycle history as "client connection verified". Without dumping error
logs or private notes into the chat, explain the fault and the smallest fix.

If a source change isn't indexed, `python3 beyin.py sync`; if skill files differ, reconcile deliberately with
`python3 beyin.py skill-sync`. If both sides changed, keep the files and say which version has to be chosen. If an
update was left half-done, use the `brain-update` path; never turn a health indicator green by deleting the runtime
database or the user's files.

When the client connection has to be verified, use a probe note that contains no private data. In a new real
session, asking for the information in that note from hook context alone is stronger evidence than checking that
the file exists. For Codex check the right project and the `/hooks` trust, for Claude a new project session, for
Antigravity headless use the `--add-dir VAULT` binding, for OpenCode that it opens in the vault folder and that
`.opencode/plugins/beyin-v3.js` exists, for OMP that it opens in the vault folder and that
`.omp/hooks/pre/beyin-v3.ts` exists. Don't print trust hashes, and don't count a result obtained by bypassing as
proof of a normal installation.

The `companion_hygiene` section shows the character counts of the companion files. If `over_limit` contains
Last-Session.md or Threads.md, that is a memory-hygiene finding, not a sync fault: show the plan with
`python3 beyin.py companion-compact --dry-run`, and if it looks right run `companion-compact`. The command moves
old sections word for word into `Arşiv/` and deletes no text. Kurallar.md, Core.md and Journal.md accumulate on
purpose; report their sizes as information only.

The `instruction_references` section lists the `[[wikilink]]` and `[text](path)` links in AGENTS.md, CLAUDE.md,
companion Kurallar.md and the skill folders that have no target inside the vault, with file and line; code blocks
are not counted. This is informational and does not make the status `needs_attention`: tell the user which
instruction now points at a note that no longer exists, offer to fix the link if the target moved, and don't invent
a note on your own.

Records inside `validity.ignored_rejections` say `validity: rejected` but their `kind` is neither inference nor
preference, so the claim is still in current context. If the user really rejected that claim, add `kind: inference`
(or `preference`) to the source; if they didn't, remove the `validity` field. Don't delete the source.

`validity.rejected_dependents` lists current notes that link to a rejected inference through `[[wikilink]]` or
`[text](path)`; `ambiguous_rejected_links` additionally shows a link when several notes share the same file name
and one of them is rejected. This is informational and does not make the status `needs_attention`: the link may be
explaining the reason for the rejection. Tell the user which note rests on the rejected claim; if the note still
treats that claim as true, offer a correction or a link to a new note via `supersedes`. Don't change or reject the
note on your own.

`review.due` shows that a note's own `review_at` date has arrived: a time to reconsider an idea, not a fault. Tell
the user which notes are waiting; offer to push the date forward, turn the note into a task, or retire it, and
leave the decision to them. `review.invalid` lists values that are not real dates; ask the user for the right date,
don't guess.

The `inbox` section is only filled when the user said `--inbox-report on`: the number of notes waiting in the inbox
folders and the age of the oldest note. For a folder with `attention`, tell the user how many notes have been
waiting and for how long, and offer to process them; don't move, classify or delete notes on your own. If the list
is empty or the inbox lives under another name, suggest `--inbox-folder` with the folder name; don't guess the name.

Tell the user three things: the part that works, the unverified/broken part, and the single next fix if there is
one. Give a short, concrete result instead of raw JSON. If the user's existing approval covers the safe fix, don't
ask again for nothing.

V3.1: the `updates` section inside `doctor` shows the latest version check; a network error does not prove being up
to date. Use `beyin.py update --check --metadata-only` only for a version question. Route an update request to the
`brain-update` skill.

**Structural auditing is not `doctor`'s job.** Note/task/link graph, single-ownership violations, broken links,
traces of dead claims → delegate to a read-only vault-audit sub-agent: it returns evidenced findings plus a
single-step suggestion and **writes nothing**. You make the decision and apply it (proposal → approval → single
command). For the graph's quantitative state, run the vault's graph tool first if it ships one — call the
sub-agent only when interpretation is needed.
