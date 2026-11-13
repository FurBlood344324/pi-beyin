# pi-beyin

[pi](https://pi.dev) bridge for the **beyin** second brain (the JS CLI: `bin/beyin.js`, on `PATH` as `beyin`).
It is deliberately thin: the vault owns the bytes, the budget and every write; this package only wires the
vault into a pi session.

## What you get

| Resource | What it does |
|---|---|
| `extensions/beyin.ts` | **Session start:** runs `beyin ingest --all` and then `beyin dream --once` in one detached shell, so the session never waits. **Before each agent start:** injects the `beyin context` block as a hidden message, once per session and again only when the working directory changes. |
| `extensions/beyin.ts` (tools) | Five native tools, called like `bash` or `write`: `beyin_recall`, `beyin_note`, `beyin_correct`, `beyin_receipt`, `beyin_task`. Each maps its parameters to the CLI's flags, runs `beyin` and returns the output; the CLI owns every rule. |
| `extensions/batch.ts` | Notices when tool calls go out one per turn and says so once: independent calls can share one message, dependent or filtered chains belong in one `codemode` script. Silent for parallel work. Off with `BEYIN_BATCH=0`. |

The only registered tools are the five thin wrappers above; there are no skills and no helper scripts in this
package. Everything else reaches the vault by running the CLI through the shared `beyin` skill. Skills (`beyin`, `brain-doctor`, `experiment-record`,
`journal`, `literature`, `maintenance`, `source-distillation`) and the vault tools (`exp-record`,
`maint-scan`, `vault-graf.py`, `beyin-smoke`, the dream scripts) live in the vault under
`.agents/{skills,tools}` and are linked into pi from there. One owner, no copy to drift.

The injected block is the CLI's own bytes: the adapter formats nothing and applies no cap (the 4,900 B
budget belongs to the vault). A failed call, a missing CLI or an empty vault injects nothing and never
throws. Retrieved vault content is **data**, not instructions.

`beyin dream --once` spends a model call. How often it may run (lock, finished-session test, daily ceiling)
is the CLI's decision, not this package's; a missed knock costs one session of latency, never a duplicate.

## Requirements

- The `beyin` CLI on `PATH` (Node >= 22). The vault is resolved by the CLI itself: `BEYIN_ROOT`, then
  `~/.config/beyin/config.json` (`{ "vault": "..." }`). This package names no vault path.
- pi with the extension API (`on("session_start")`, `on("before_agent_start")`).

Where `beyin` is not on `PATH` yet (development), two overrides find the executable:

- `BEYIN_CLI`: the full path to `bin/beyin.js`
- `BEYIN_PACKAGE_ROOT`: a checkout; the adapter calls `<root>/bin/beyin.js`

## Install

```bash
pi install npm:pi-beyin
# or a pinned git ref
pi install git:github.com/FurBlood344324/pi-beyin@v0.3.0
# or a local checkout (loaded in place, not copied)
pi install ~/projects/pi-beyin
```

Use **one** install path. The vault's own installer (`adapters/pi/install.mjs`) writes the same adapter into
`~/.pi/agent/extensions/beyin.ts` and removes `npm:pi-beyin` from `packages`; running both loads the adapter
twice and injects the context twice. Remove old copies first (`~/.pi/agent/extensions/beyin-*.ts`).

Verify what loaded:

```bash
pi list                                  # the package and its resolved path
# a pi session should show one beyin-context message, not two
beyin-smoke ~/projects/<project>         # the whole chain from a project directory (vault tool)
```

## Upgrading from 0.2.x

0.3.0 is a breaking change. The package no longer bridges the Python `beyin.py` vault. Removed with it:
`extensions/context.ts`, `distillation.ts`, `jev.ts`, `compact.ts`, the bundled skills, `tools/` (the
harness patch, `jev-pick.py`, `exp-record`, `maint-scan`) and the `beyin_jev_*` tools and slash commands.
The JS CLI has no equivalent of Jev, `brain-update` or the harness patch, so nothing replaces them here.
Also remove `~/.config/beyin/pi-hook.json` keys that belonged to those extensions.

## Develop

```bash
bash test/run.sh          # smoke + beyin adapter + batch; no vault, model or network needed
bun run typecheck         # needs @earendil-works/pi-coding-agent and pi-ai as host types
```

## License

MIT
