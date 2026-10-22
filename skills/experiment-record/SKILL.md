---
name: experiment-record
description: Experiment and decision record standard (project memory). Use for requests like "deney kaydet", "bu denemeyi yaz", "logs'a bak", "record this run", "check the logs". Records training, fine-tuning, ablations, dataset experiments, debugging sessions and decisions that must persist, in a reproducible form. Paths and scope come from .pi/beyin-project.json.
---

# Experiment Record — Experiment and Decision Log

Language: write in the user's language and reuse the target file's headings — see `../_shared/project-profile.md` (Language).

## 0) Read the project profile
First read `<project root>/.pi/beyin-project.json`. Fields:

```json
{
  "name": "example-project",
  "root": "/home/user/projects/example",
  "logs": "logs",                 // experiment/decision records (NNNN-title.md)
  "log_index": "logs/index.md",   // index (optional)
  "journal": "journal",           // daily journal (YYYY-MM-DD.md)
  "literature": "literature",     // paper notes
  "state": "STATE.md",            // live state (optional)
  "progress": "progress.md",      // roadmap (optional)
  "report_dir": "reports",        // derived report directory (optional)
  "scopes": ["product", "harness"], // if set, records get a Scope field; the report sees only the first
  "secret_dirs": ["label_img"],   // never read, never copied
  "hardware": "local GPU / Colab T4"
}
```

No profile → default: records in `logs/`, index `logs/index.md`. If unsure, ask the user.
Full schema and field table: `../_shared/project-profile.md`.
Nothing under `secret_dirs` is read, copied or versioned.

## Why
Running the same experiment twice = lost time. Every experiment keeps **in one file** what settings gave
what result; durable decisions go here too so they survive across sessions.

## AUTOMATIC RECORDING — don't wait for a trigger
You may load and apply this skill without the user saying "record":
> Work finished → measurable result / decision / new constraint? → if yes, **record** → report in one line.
- **Never record silently.** After each record, say in one line what you wrote.
- **When in doubt, record** (over-recording > under-recording).
- Don't rewrite what is already written (check logs/index/state file first).

### Scope
| Situation | Record? | Where |
|---|---|---|
| Training/experiment result (metric, duration, VRAM) | yes | `<logs>/` |
| OOM / error / failed attempt | yes | `<logs>/` |
| Decision (branch, tool, roadmap change) | yes | `<logs>/` + `<progress>` |
| Infrastructure/system change (record layout, skill) | yes (`harness` scope if set) | `<logs>/` |
| New constraint/discovery (stack, hardware, data) | yes | `<logs>/` |
| Only a question was asked, no work | no | — |
| Info already written | no | — |

## Procedure
1. Find the highest number in `<logs>/`, add 1.
2. Check the `<logs>/` index (if any): does the same experiment/control already exist? If so, don't rewrite.
3. Fill the template, write `NNNN-short-title.md`.
4. Update the index (number, title, main result, date).
5. One-line summary to the user: number, goal, main result, decision.

## {NNNN}-{title}.md template

The headings below are defaults for a **new** log. If the directory's existing logs use other
headings (for example Turkish `## Sonuçlar`), copy those instead — one directory, one style.
```markdown
# {NNNN} — {short title}
- **Date:** YYYY-MM-DD
- **Scope:** {only if profile defines `scopes`: first is product/work, second is infrastructure}
- **Goal / hypothesis:** (one sentence: what am I testing, why)
- **Dataset:** (name, size, class count, split)
- **Model / backbone:** 
- **Settings:** batch=, lr=, epochs=, img_size=, optimizer=, AMP=, freeze=
- **Seed:** (state it; "not specified" if none)
- **Hardware:** 
- **Duration:** 

## Results
| Metric | Value |
|---|---|
| ... | ... |

## Observation
(What happened? Gap vs expectation? Surprises? Did it OOM, and why?)

## Decision
(What changes next attempt? Keep or drop?)

## Next step
(one concrete step)
```

## Rules
- Write the **Scope** field only when the profile defines `scopes` (it is the report filter).
- **Write the seed.** "Not specified" beats reproducing the wrong result.
- **Failed experiments are recorded too.** "That setting OOM'd" may be the most valuable fact.
- **Never invent metrics.** If you didn't measure it, write "not measured". Don't inflate interpretation;
  the number is the number.
- Short title; variants of the same experiment share a root name (`yolo-batch8`, `yolo-batch8-amp`).
- If the result includes code, write the file path too.

## index.md template (when the profile defines `log_index`)
```markdown
# Experiment/Decision Index
| # | Title | Main result | Date |
|---|---|---|---|
| 0001 | ... | ... | YYYY-MM-DD |
```
