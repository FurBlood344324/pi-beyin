---
name: experiment-record
description: Experiment and decision record standard (project memory). Use for requests like "deney kaydet", "bu denemeyi yaz", "logs'a bak", "record this run", "check the logs". Records training, fine-tuning, ablations, dataset experiments, debugging sessions and decisions that must persist, in a reproducible form. Paths and scope come from .pi/beyin-project.json.
---

# Experiment Record - Experiment and Decision Log

Language: write in the user's language and reuse the target file's headings; see
`../_shared/project-profile.md` (Language).

## Why
Running the same experiment twice is lost time. One file keeps what settings gave what result, and
decisions sit beside the results so the next session does not re-derive them.

## Command
The mechanical part (next number, file, template, index, gap check) is `tools/exp-record` in this
package, two levels above this skill's directory. Run it from the project: it finds
`.pi/beyin-project.json` by walking up from the cwd, so any subdirectory works.

    exp-record next                                     next free number
    exp-record new --title "batch 8 OOM" --scope product
    exp-record index                                    rebuild the table from the files
    exp-record check                                    unfilled fields (exit 1)

`--help` has the flags; pass `--slug` when the title is not ASCII. Script missing: say so, do the
step by hand, never guess a number. The judgement stays here: what deserves a record, what the
fields mean, whether a result is real.

## Automatic recording - don't wait for a trigger
You may apply this skill without the user saying "record":
> Work finished -> measurable result, decision, new constraint? -> yes: record, then report in one line.
- Never record silently: after each record say in one line what you wrote.
- When in doubt, record; don't rewrite what is already written (read the index first).

## Scope: what deserves a record
| Situation | Record? | Where |
|---|---|---|
| Training/experiment result (metric, duration, VRAM) | yes | `<logs>/` |
| OOM, error, failed attempt | yes | `<logs>/` |
| Decision (branch, tool, roadmap change) | yes | `<logs>/` + `<progress>` |
| Infrastructure/system change (record layout, skill) | yes (`harness` scope if set) | `<logs>/` |
| New constraint (stack, hardware, data) | yes | `<logs>/` |
| Only a question was asked, no work | no | - |
| Info already written | no | - |

## Fields the template asks for
- **Goal / hypothesis** one sentence: what is tested, and why.
- **Dataset, Model / backbone** name, size, class count, split; don't write what you did not check.
- **Settings** batch, lr, epochs, img_size, optimizer, AMP, freeze.
- **Seed** state it; "not specified" beats reproducing the wrong result.
- **Hardware, Duration** real machine and wall clock.
- **Scope** written only when the profile declares `scopes`; the first is the product/report view,
  the second is infrastructure.
- **Results, Observation, Decision, Next step** measured metrics; gap vs expectation; what changes
  next attempt; one concrete next step.
- **Never invent metrics.** "not measured" is a result; the number is the number.

## After the script
1. Fill the fields. Short title; variants of one experiment share a root name
   (`yolo-batch8`, `yolo-batch8-amp`).
2. If the directory's existing records use other headings, match them in this file too.
3. `exp-record check` before you close; a decision record may leave experiment fields empty, so say
   why in the record instead of inventing values.
4. One line to the user: number, goal, main result, decision.
5. If code produced the result, write its path in the record.
