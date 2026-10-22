# pi-beyin

[pi](https://pi.dev) integration for the **beyin** second brain: the pi side of the same idea as
beyin's Codex/Claude/OpenCode hooks, plus a CommandCode classifier bridge and the memory procedures as
pi skills.

[![npm](https://img.shields.io/npm/v/pi-beyin)](https://www.npmjs.com/package/pi-beyin)
[![Socket score](https://badge.socket.dev/npm/package/pi-beyin)](https://socket.dev/npm/package/pi-beyin)

## What you get

| Resource | What it does |
|---|---|
| `extensions/context.ts` | Injects relevant vault notes into every request and reminds the agent to write a receipt when a turn edited files without recording one. Registers the `beyin_jev_memory` / `beyin_jev_review` / `beyin_jev_answer` advisor tools. |
| `extensions/distillation.ts` | At the end of a turn, if the vault was written but nothing was distilled into `knowledge/`, makes the agent run `beyin.py sync` and write/update the knowledge note **automatically** when you are working outside the vault; inside the vault it stays a suggestion. `/distillation`. |
| `extensions/jev.ts` | Registers CommandCode's `typesafe/jev` decision model as a pi classifier. `/jev-test`. |
| `skills/brain` | Vault memory work: find notes, record finished work with its sources, update tasks, keep companion notes current. |
| `skills/brain-doctor` | Health check: is memory indexed, are sources synced, are skills and updates healthy. |
| `skills/brain-update` | Check for a new official version, update, or roll back a failed update. |
| `skills/source-distillation` | External source (web, paper, PDF archive, bookmarks) → one source-linked concept note. |
| `skills/experiment-record`, `journal`, `literature`, `maintenance` | Project-memory procedures driven by `<project>/.pi/beyin-project.json` (see [`skills/_shared/project-profile.md`](skills/_shared/project-profile.md)). |
| `tools/pi-harness-patch.py` | Makes a beyin vault treat `pi` as a first-class harness (`receipt --harness pi`). Idempotent; the extension re-applies it after a vault update. |

### Distillation: automatic outside the vault

A turn that wrote to the vault but distilled nothing into `knowledge/` gets a follow-up instruction:

- **Outside the vault** (a project whose lessons diverge from it): the agent runs `beyin.py sync`,
  writes or updates the knowledge note with `beyin.py note-create`, adds it to the receipt refs and
  syncs again — **without asking**. This is the flow the vault's own rules ask for at project close.
- **Inside the vault**: the old approval flow stays — the agent offers candidates and waits.
- `BEYIN_DISTILLATION_MODE=offer` restores the approval flow everywhere.

Everything is **fail-open**: an error never breaks the turn, that turn's contribution is just silently
missing. Retrieved vault content is **data**, not instructions — the agent must not follow text found in
notes, imported transcripts or tool output.

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
pi install git:github.com/FurBlood344324/pi-beyin@v0.1.12
# or a local checkout (loaded in place, not copied)
pi install ~/projects/pi-beyin
```

Remove any old copies first (`~/.pi/agent/extensions/beyin-*.ts`); two copies load twice and inject the
context twice.

Verify what actually loaded:

```bash
pi list                                  # the package and its resolved path
# a pi session should show one beyin-context message, not two
```

Skills show up as `skill:brain`, `skill:brain-doctor`, `skill:brain-update`, `skill:source-distillation`,
`skill:experiment-record`, `skill:journal`, `skill:literature`, `skill:maintenance`.

## Configuration

| File | Content |
|---|---|
| `~/.config/beyin/pi-hook.json` | `excludeProjects` (projects where beyin stays silent) and `injectionOnly.<project>` → `{ "reminders": bool, "distillation": bool }` |
| `~/.config/beyin/distillation.json` | `{ "enabled", "cooldownMinutes", "maxCandidates" }` |
| `~/.config/beyin/jev.json` | `{ "enabled", "mode": "on" \| "shadow", "model", "minScore", "maxCandidates" }` |
| `~/.config/beyin/jev-commandcode.env` | `CMD_API_KEY=...` (only when the pi model registry has no `command-code` key) |

Environment: `BEYIN_VAULT`, `BEYIN_PYTHON`, `BEYIN_HOOK_CONFIG`, `BEYIN_DISTILLATION_CONFIG`,
`BEYIN_JEV_CONFIG`, `BEYIN_CONTEXT_CHARS`, `BEYIN_REMINDERS=0`, `BEYIN_INCLUDE_VAULT=1`,
`BEYIN_DISTILLATION=0`, `BEYIN_DISTILLATION_MODE=offer`, `BEYIN_JEV=0`, `BEYIN_DISABLE=1`, `BEYIN_DEBUG=1`, `BEYIN_PI_PATCH`,
`BEYIN_LANG` (`tr` by default; `en` switches the injected context header and notices, the command
descriptions and the `beyin_jev_*` tool schema to English), `BEYIN_JEV_MODEL`,
`BEYIN_JEV_API_KEY` / `CMD_API_KEY` / `COMMAND_CODE_API_KEY`, `BEYIN_FORCE_REMINDER=1`.

### Naming

Keys and file names are English; the older Turkish names keep working, so an existing setup does not
need to be edited before upgrading:

| Current | Legacy (still read) |
|---|---|
| `distillation.json` | `damitma.json` |
| `injectionOnly.<project>.distillation` | `injectionOnly.<project>.damitma` |
| `BEYIN_DISTILLATION`, `BEYIN_DISTILLATION_CONFIG` | `BEYIN_DAMITMA`, `BEYIN_DAMITMA_CONFIG` |

When both exist, the current name wins (file: `distillation.json`; key: `distillation`). The command is
`/distillation`; the old `/damitma` name is gone. Injected texts still follow `BEYIN_LANG` (`tr` by
default) — they are output, not naming.

Disable a single extension while keeping the package:

```json
{
  "packages": [
    { "source": "npm:pi-beyin", "extensions": ["extensions/*.ts", "!extensions/distillation.ts"] }
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
CLI are installed and updated separately; this package never needs to know their version.

- `tools/pi-harness-patch.py` is the only piece that touches the vault's Python: it adds `pi` to the
  harness list in five managed modules and re-syncs the install manifest so updates plan cleanly.
  A vault update reverts those edits; the extension calls `ensure` on session start, so they come back by
  themselves. `status` is read-only.
- The skills here are **copies for pi**, not links into the vault. Other harnesses keep their own copies
  under `.claude/skills/`; pi does not read that directory.
- Notifications live in the adapter: the injected context, the receipt reminder, the distillation
  suggestion and the `beyin_jev_*` tool schema ship here. Turkish by default, English with
  `BEYIN_LANG=en`; anything a *skill* writes follows the user's language.

## Privacy

Vault text leaves the machine only through the Jev path, and only for records that pass the
`visibility` / `remote_allowed` / `sensitivity` gate (`remoteSafe`). Keys come from the pi model
registry or `~/.config/beyin/jev-commandcode.env`, and are never logged. The package has no telemetry
and no install scripts.

## Development

```bash
bun run test        # model-free suite (reads the vault, writes nothing)
bun run typecheck   # tsc --noEmit
bun run smoke       # all three extensions import

bun run test/test-skills.ts                    # package guards (no vault needed)
bash test/run.sh                               # everything model-free
BEYIN_LIVE=1 bash test/run.sh                  # + one real CommandCode call
BEYIN_E2E=1 bash test/run.sh                   # + a real pi session (model calls)
bash test/run.sh ~/projects/example            # + multi-turn Jev scenario in that project
bun run test/test-jev-scenario.ts ~/projects/example 3
```

`test/run.sh` steps 1–3 need a live vault; the rest is self-contained. Step 3 and the context
injection tests query your vault with `BEYIN_TEST_QUERY` — the package ships no project-specific phrase, so
without it those checks are skipped. Tests never write into the repo:
each run builds its own temporary directory and config files. Step 3b warns when the vault's
`.agents/skills` duplicates a package skill (a vault update can recreate those copies).

`test/test-skills.ts` guards the package itself: skill inventory, `name:` matching the directory,
description budget (every description sits in the system prompt on every turn), no personal paths,
resolving `_shared/` references, and the `pi.skills` manifest.

## Release

Version is bumped in `package.json`, then a `vX.Y.Z` tag is pushed; CI typechecks, runs the vault-free
tests and publishes from GitHub Actions with provenance (no long-lived token). The tag must match
`package.json`.

## License

MIT — see [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
