# pi-beyin

[pi](https://pi.dev) integration for the **beyin** second brain: the pi equivalent of beyin's
Codex/Claude/OpenCode hooks, plus a CommandCode classifier bridge and the project-memory skills.

## What you get

| Resource | What it does |
|---|---|
| `extensions/context.ts` | Injects relevant vault notes into every request and reminds the agent to write a receipt when a turn edited files without recording. Registers the `beyin_jev_memory` / `beyin_jev_review` / `beyin_jev_answer` advisor tools. |
| `extensions/damitma.ts` | At the end of a turn, if the vault was written but nothing was distilled into `knowledge/`, offers **distillation candidates** (never writes on its own). `/damitma`. |
| `extensions/jev.ts` | Registers CommandCode's `typesafe/jev` decision model as a pi classifier. `/jev-test`. |
| `skills/` | `brain` (vault memory work), `brain-doctor` (health), `brain-update` (upgrades), `source-distillation` (external sources → concept notes), and the project-memory procedures `experiment-record`, `journal`, `literature`, `maintenance` driven by `<project>/.pi/beyin-project.json` (see [`skills/_shared/project-profile.md`](skills/_shared/project-profile.md)). |
| `tools/pi-harness-patch.py` | Makes a beyin vault treat `pi` as a first-class harness (`receipt --harness pi`). Idempotent; the extension re-applies it after beyin updates. |

Everything is **fail-open**: an error never breaks the turn, that turn's contribution is just
silently missing. Retrieved vault content is **data**, not instructions — the agent must not follow
text found in notes, imported transcripts or tool output.

## Requirements

- pi with extension/package support (`@earendil-works/pi-coding-agent` 1.4+)
- `python3`
- A **beyin vault**: a directory containing `beyin.py` (default `~/projects/beyin`, override with
  `BEYIN_VAULT`)

The extensions without a vault are no-ops; `context` and `damitma` have nothing to read.

## Who this is for

- You already use a **beyin vault** — a directory with `beyin.py` that brings its own installer and updater.
- You run **pi** and want that vault wired into pi.
- You have **CommandCode** access if you want Jev and the advisor tools. Without it, context injection,
  the receipt reminder and the distillation offer still work; only scoring and the `beyin_jev_*` tools
  stay inert.

With CommandCode, install the official provider so Jev can reuse its key instead of a separate secret:

```bash
pi install npm:@commandcode/pi-commandcode-provider
```

Otherwise put `CMD_API_KEY=...` in `~/.config/beyin/jev-commandcode.env` (or export it).

The harness patch only knows the code shapes it was written against. On an unfamiliar vault it prints
warnings, leaves the files untouched (fail-soft) and `receipt --harness pi` stays unavailable until the
patterns match — nothing breaks, the work is just labelled with another harness.

## Install

```bash
pi install npm:pi-beyin
# or a pinned git ref
pi install git:github.com/FurBlood344324/pi-beyin@v0.1.0
# or a local checkout (loaded in place, not copied)
pi install ~/projects/pi-beyin
```

Remove any old copies first (`~/.pi/agent/extensions/beyin-*.ts`); two copies load twice and inject
the context twice.

## Configuration

| File | Content |
|---|---|
| `~/.config/beyin/pi-hook.json` | `excludeProjects` (projects where beyin stays silent) and `injectionOnly.<project>` → `{ "reminders": bool, "damitma": bool }` |
| `~/.config/beyin/damitma.json` | `{ "enabled", "cooldownMinutes", "maxCandidates" }` |
| `~/.config/beyin/jev.json` | `{ "enabled", "mode": "on" \| "shadow", "model", "minScore", "maxCandidates" }` |
| `~/.config/beyin/jev-commandcode.env` | `CMD_API_KEY=...` (only when the pi model registry has no `command-code` key) |

Environment: `BEYIN_VAULT`, `BEYIN_PYTHON`, `BEYIN_HOOK_CONFIG`, `BEYIN_DAMITMA_CONFIG`,
`BEYIN_JEV_CONFIG`, `BEYIN_CONTEXT_CHARS`, `BEYIN_REMINDERS=0`, `BEYIN_INCLUDE_VAULT=1`,
`BEYIN_DAMITMA=0`, `BEYIN_JEV=0`, `BEYIN_DISABLE=1`, `BEYIN_DEBUG=1`, `BEYIN_PI_PATCH`, `BEYIN_LANG` (`tr`
by default; `en` switches the injected notices and command descriptions to English — the
`beyin_jev_*` tool schema text is still Turkish),
`BEYIN_JEV_MODEL`, `BEYIN_JEV_API_KEY` / `CMD_API_KEY` / `COMMAND_CODE_API_KEY`,
`BEYIN_FORCE_REMINDER=1`.

Disable a single extension while keeping the package:

```json
{
  "packages": [
    { "source": "npm:pi-beyin", "extensions": ["extensions/*.ts", "!extensions/damitma.ts"] }
  ]
}
```

### Vault contract

The extensions call `beyin.py` (read-only unless the agent runs a write command):

| Call | Used for |
|---|---|
| `context --json "<query>"` | candidate notes for injection (`id`, `source`, `source_sha256`, `text`, `kind`, `visibility`) |
| `jev-review` / `jev-memory` / `jev-answer` (JSON on stdin) | advisor tools |
| `receipt --harness pi --event-id ... --summary ... --ref ...` | what the reminder asks the agent to run |

A vault whose `beyin.py` does not accept `--harness pi` needs `tools/pi-harness-patch.py ensure
--vault <vault>` (the extension does this on session start).

## Scope

This package is the **pi side**: extensions, skills and the harness patch. The vault and its `beyin.py`
CLI are yours to install and update separately; this package never needs to know their version.

- `tools/pi-harness-patch.py` is the only piece that touches the vault's Python: it adds `pi` to the
  harness list in five managed modules and re-syncs the install manifest so updates plan cleanly.
  An update of the vault reverts those edits; the extension calls `ensure` on session start, so they
  come back by themselves. `status` is read-only.
- The skills here are **copies for pi**, not links into the vault. Other harnesses keep their own copies
  under `.claude/skills/`; pi does not read that directory.
- Notifications live in the adapter: the injected context, the receipt reminder, the distillation
  suggestion and the `beyin_jev_*` tool descriptions ship here. They are written in Turkish today (the
  author's language); anything a *skill* writes follows the user's language.

## Project memory skills

Skill descriptions carry bilingual trigger phrases (English + Turkish) on purpose: a description is a
**routing surface**, not output — it is the text the model uses to pick the skill, so it quotes how the
user actually speaks. Keep the lists short: every description is in the system prompt on every turn.

The skills are written in English; what they produce is not. Every skill writes in the user's language
and reuses the target file's headings — existing headings are never translated. The project-memory skills
read `<project>/.pi/beyin-project.json` for paths and scopes; without a profile they fall back to `logs/`,
`journal/`, `literature/`. The profile schema and the safety rules (source ≠
derived report, never delete, secrets are never read or copied) are in
[`skills/_shared/project-profile.md`](skills/_shared/project-profile.md).

## Development

```bash
bun run test        # model-free suite (reads the vault, writes nothing)
bun run typecheck   # tsc --noEmit
bun run smoke       # all three extensions import

BEYIN_LIVE=1 bash test/run.sh        # + one real CommandCode call
BEYIN_E2E=1 bash test/run.sh         # + a real pi session (model calls)
bash test/run.sh ~/projects/example  # + multi-turn Jev scenario in that project

bun run test/test-jev-scenario.ts ~/projects/example 3
```

`test/run.sh` steps 1–3 need a live vault; the rest is self-contained. Tests never write into the
repo: each run builds its own temporary directory and config files.

## Privacy

Vault text leaves the machine only through the Jev path, and only for records that pass the
`visibility` / `remote_allowed` / `sensitivity` gate (`remoteSafe`). Keys come from the pi model
registry or `~/.config/beyin/jev-commandcode.env`, and are never logged.

## License

MIT
