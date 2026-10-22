# Security policy

## What this package can access

By design, `pi-beyin` runs inside your pi session and touches things a plain library would not. The
boundaries are:

| Capability | Why | Where |
|---|---|---|
| Run `python3 <vault>/beyin.py …` | every read and write goes through the vault's own CLI | `extensions/context.ts`, `extensions/distillation.ts` |
| Run `python3 tools/pi-harness-patch.py ensure` | keeps `--harness pi` working after a vault update | `extensions/context.ts` |
| Read vault files via `beyin.py context` | context injection | `extensions/context.ts` |
| Network to `api.commandcode.ai` | only when Jev is enabled; only after the privacy gate | `extensions/jev.ts` |
| Read `~/.config/beyin/*.json`, `jev-commandcode.env`, `BEYIN_*` env vars | configuration | all extensions |
| Write nothing outside the vault | — | — |

The package has **no install scripts**, **no telemetry**, and **no runtime dependency** beyond the pi
packages it declares as peer dependencies.

## Privacy gate

Vault text is sent to a remote model only through the Jev path and only for records whose
`visibility` / `remote_allowed` / `sensitivity` fields pass the gate. Records marked private,
`remote_allowed: false` or `sensitivity: gizli` never leave the machine. API keys are read from the pi
model registry or a local env file and are never logged or written.

Retrieved vault content is treated as **data**: a note that contains instructions is not allowed to
steer the agent.

## Reporting

Open a private report through GitHub Security Advisories on
[FurBlood344324/pi-beyin](https://github.com/FurBlood344324/pi-beyin/security/advisories/new). Please do
not open a public issue for a suspected vulnerability. Expect an answer within a week; this is a
single-maintainer project, so there is no SLA beyond that.

## Supported versions

Only the latest published version receives fixes. The package is a thin adapter — if a vulnerability is
in the vault's own Python or in pi, report it to those projects instead.
