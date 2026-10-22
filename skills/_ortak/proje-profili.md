# Project Profile Schema (`<project>/.pi/beyin-project.json`)

The portable skills (`deney-kaydi`, `gunluk`, `literatur`, `bakim`) read their paths from this file, so the
same skill writes into each project's own directories.

## Schema
```json
{
  "name": "example",
  "root": "/home/user/projects/example",
  "logs": "logs",
  "log_index": "logs/index.md",
  "journal": "journal",
  "literature": "literature",
  "state": "STATE.md",
  "progress": "progress.md",
  "report_dir": "reports",
  "scopes": ["product", "harness"],
  "close_steps": ["bash scripts/summary.sh --write"],
  "secret_dirs": ["label_img", "private"],
  "hardware": "local GPU / remote runner"
}
```

## Fields
| Field | Required | Description |
|---|---|---|
| `name` | yes | Project name |
| `root` | yes | Absolute project root |
| `logs` | yes | Experiment/decision records (`NNNN-title.md`) |
| `log_index` | – | Index file |
| `journal` | – | Journal directory (default `journal/`) |
| `literature` | – | Paper notes (default `literature/`) |
| `state` | – | Live state file |
| `progress` | – | Roadmap file |
| `report_dir` | – | Derived report directory |
| `scopes` | – | If set, every record gets a `Scope` field; the report sees **only the first** |
| `close_steps` | – | **Idempotent, derived-only** shell commands run at close (see below) |
| `secret_dirs` | – | Never read, never copied |
| `hardware` | – | Hardware note (referenced in records) |

## Rules
- Paths are written **relative to the project root** (absolute values also work).
- Without a profile the skills fall back to `logs/`, `journal/`, `literature/`.
- Nothing under `secret_dirs` is read or copied; it never enters a report.
- `close_steps` commands run from the project root and must be **idempotent** and **derived-only**
  (they do not touch source data or human effort, and contain no delete/move). Being defined in the profile is
  pre-approval; the `bakim` skill runs them at close and reports their output. Destructive/deleting work is
  **never** written here.
