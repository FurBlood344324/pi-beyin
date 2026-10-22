---
name: literature
description: Literature/paper reading-task assignment and note-taking procedure. Use for requests like "literatür", "makale oku", "paper oku", "şu makaleyi oku", "okuma görevi ver", "not ekle", "şunu okudum anlatayım", "teori çalış", "read this paper", "give me a reading task", "add a note". Assigns reading tasks with focus questions; when the user explains what they read, writes an ordered note into the literature directory. Applies the "concept before tool" principle. Paths come from the project profile.
---

# Literature — Task Assignment and Note-Taking

Language: write in the user's language and reuse the target file's headings — see `../_shared/project-profile.md` (Language).

## Paths (from the project profile)
`<project root>/.pi/beyin-project.json` → `literature` (default `literature/`).
Plan: `<literature>/plan.md` · Notes: `<literature>/NN-topic.md` · Template: `<literature>/_note-template.md`.
Schema: `../_shared/project-profile.md`.

## Purpose
**Concept before tool.** Before producing code/output, establish *why* the models in use work.

## Learning loop (the actual mechanism)
```
assign task (source + focus questions) → user reads → user EXPLAINS IT TO ME
        → I write the note (with corrections) → reference during the coding stage
```
Feynman: if the user can't explain it, they haven't understood it. The note is not a copy of the paper;
it is **the user's understanding** + my correction.

## Procedure
1. Read `<literature>/plan.md`; determine the next **task** and its status.
2. Give the user the task: **source + focus questions + explanation target** (don't dump a long list; focus
   on few tasks).
3. When the user explains, write the note per the template:
   - "My explanation" = the user's sentences (simplify, don't distort).
   - "Gaps / corrections" = points they skipped or misread (critical).
   - "Where this note connects" = which core/metric/code part.
4. Update status: `plan.md` table (`[ ]` → `[x]`), `progress`, journal.
5. Give a one-line summary: which note was written, main takeaway.

## What to record
- If a concept is wrong, don't let it slide — **correct it** (this is where the skill's value is).
- Don't invent metrics/steps; what the user explained + verification.
- Don't copy the paper's abstract verbatim (a copy is not learning).

## Triggering
- User: "literature", "read a paper", "that paper", "add a note", "I read it, let me explain".
- Automatic: when a task completes, **propose** the next one (don't force it).

## Plan changes
If a new paper/priority is needed: state why → user approval → update `plan.md` + `progress`.

## Durable concept
If a reusable concept emerged, propose a **short, source-linked** note under `knowledge/concepts/` in the
shared knowledge vault (a distillation, not a copy).
