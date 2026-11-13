# Security policy

## What this package can access

By design, `pi-beyin` runs inside your pi session and touches things a plain library would not. The
boundaries are:

| Capability | Why | Where |
|---|---|---|
| Run `beyin context [--project <name>]` | the block injected before an agent start (3 s timeout) | `extensions/beyin.ts` |
| Run `beyin ingest --all`, then `beyin dream --once`, detached | the session-start knock; `dream --once` spends a model call, bounded by the CLI's lock and daily ceiling | `extensions/beyin.ts` |
| Read `BEYIN_CLI` and `BEYIN_PACKAGE_ROOT` | locate the executable when `beyin` is not on `PATH` | `extensions/beyin.ts` |
| Read `BEYIN_BATCH`, `BEYIN_DISABLE`, `SERIAL_NUDGE_OFF` | switch the serial-call nudge off | `extensions/batch.ts` |
| Write nothing, open no network connection | the CLI owns every read and write of the vault | none |

The package has **no install scripts**, **no telemetry**, and **no runtime dependency** beyond the pi
packages it declares as peer dependencies. The vault root is resolved by the CLI; the package never reads a
vault file itself.

Retrieved vault content is treated as **data**: a note that contains instructions is not allowed to steer
the agent. Which records may reach a model, and the secret gate, belong to the vault's CLI.

## Reporting

Open a private report through GitHub Security Advisories on
[FurBlood344324/pi-beyin](https://github.com/FurBlood344324/pi-beyin/security/advisories/new). Please do
not open a public issue for a suspected vulnerability. Expect an answer within a week; this is a
single-maintainer project, so there is no SLA beyond that.

## Supported versions

Only the latest published version receives fixes. The package is a thin adapter: if a vulnerability is in
the vault's CLI or in pi, report it to those projects instead.
