#!/usr/bin/env bash
# maint-scan tool test: the built-in self-test plus one fixture project in a temp dir.
# No vault, no model calls; the fixture's close steps are harmless by design.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="$DIR/../tools/maint-scan"
fails=0
ok() { printf '  \033[32m\u2713\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m\u2717\033[0m %s\n' "$1"; fails=$((fails + 1)); }
hr() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

hr "maint-scan: file and --help"
if [ -f "$TOOL" ]; then ok "tools/maint-scan exists"; else bad "tools/maint-scan is missing"; fi
if [ -f "$TOOL" ] && bash "$TOOL" --help >/dev/null 2>&1; then ok "--help exits 0"; else bad "--help exits 0"; fi

hr "maint-scan: --self-test"
if [ -f "$TOOL" ] && bash "$TOOL" --self-test; then ok "--self-test passed"; else bad "--self-test failed"; fi

hr "maint-scan: fixture project"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROJ="$TMP/proj"
mkdir -p "$PROJ/.pi" "$PROJ/logs" "$PROJ/journal" "$PROJ/private" "$PROJ/sub"
cat > "$PROJ/.pi/beyin-project.json" <<JSON
{
  "name": "fixture",
  "root": "$PROJ",
  "logs": "logs",
  "log_index": "logs/index.md",
  "state": "STATE.md",
  "progress": "progress.md",
  "journal": "journal",
  "scopes": ["product", "harness"],
  "secret_dirs": ["private"],
  "close_steps": ["test -f STATE.md", "exit 3", "rm -rf logs"]
}
JSON
printf '# live state\n- next: logs/0002-b.md\n' > "$PROJ/STATE.md"
printf '# progress\n- report: `reports/missing.md`\n- record: `logs/0001-a.md`\n' > "$PROJ/progress.md"
printf '# 0001 a\n- **Date:** 2026-01-01\n- **Scope:** product\n' > "$PROJ/logs/0001-a.md"
printf '# 0002 b\n- **Date:** 2026-01-02\n' > "$PROJ/logs/0002-b.md"
cat > "$PROJ/logs/index.md" <<'IDX'
# Experiment index

| # | Title | Main result | Date |
|---|---|---|---|
| 0001 | a | 0.1 | 2026-01-01 |
| 0009 | gone | - | 2026-01-02 |
IDX
: > "$PROJ/logs/.gitkeep"
: > "$PROJ/private/empty.bin"
printf 'today\n' > "$PROJ/journal/2026-01-01.md"

out="$(cd "$PROJ" && bash "$TOOL" close 2>&1)"; rc=$?
[ "$rc" -eq 1 ] && ok "close exits 1 when a step fails" || bad "close exits 1 when a step fails (exit $rc)"
printf '%s' "$out" | grep -q '^OK ' && ok "close reports the ok step" || bad "close reports the ok step (out: $out)"
printf '%s' "$out" | grep -q 'FAIL(3)' && ok "close reports the failing step" || bad "close reports the failing step (out: $out)"
printf '%s' "$out" | grep -q 'REFUSED' && ok "close refuses the delete step" || bad "close refuses the delete step (out: $out)"
printf '%s' "$out" | grep -q '1 ok, 1 failed, 1 refused' && ok "close summary counts verdicts" || bad "close summary counts verdicts (out: $out)"
[ -f "$PROJ/logs/0001-a.md" ] && ok "the refused step really did not run" || bad "the refused step really did not run"

out="$(cd "$PROJ/sub" && bash "$TOOL" orphans 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "orphans exits 0 (a report, not a failure)" || bad "orphans exits 0 (exit $rc)"
printf '%s' "$out" | grep -q 'reports/missing.md' && ok "orphans names the missing path" || bad "orphans names the missing path (out: $out)"
printf '%s' "$out" | grep -q 'logs/0001-a.md' && bad "orphans spares an existing path" || ok "orphans spares an existing path"

out="$(cd "$PROJ" && bash "$TOOL" empty 2>&1)"
printf '%s' "$out" | grep -q 'logs/.gitkeep' && ok "empty lists the empty file" || bad "empty lists the empty file (out: $out)"
printf '%s' "$out" | grep -q 'private/empty.bin' && bad "empty skips a secret dir" || ok "empty skips a secret dir"
printf '%s' "$out" | grep -q 'journal/2026-01-01.md' && bad "empty spares a non-empty file" || ok "empty spares a non-empty file"

out="$(cd "$PROJ" && bash "$TOOL" index 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "index exits 0 (a report, not a failure)" || bad "index exits 0 (exit $rc)"
printf '%s' "$out" | grep -q 'not-in-index.*0002-b.md' && ok "index sees a record missing from the table" || bad "index sees a record missing from the table (out: $out)"
printf '%s' "$out" | grep -q 'no-scope.*0002-b.md' && ok "index sees a record without its scope" || bad "index sees a record without its scope (out: $out)"
printf '%s' "$out" | grep -q 'stale-row.*0009' && ok "index sees a stale row" || bad "index sees a stale row (out: $out)"

out="$(cd "$PROJ" && bash "$TOOL" all 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "all exits 0" || bad "all exits 0 (exit $rc)"
printf '%s' "$out" | grep -q '^all: 5 finding(s) (orphans 1, empty 1, index 3)' && ok "all prints one verdict line" || bad "all prints one verdict line (out: $out)"

mkdir -p "$TMP/nowhere"
err="$(cd "$TMP/nowhere" && bash "$TOOL" all 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$err" | grep -q 'beyin-project.json' && [ "$(printf '%s\n' "$err" | wc -l | tr -d ' ')" = "1" ]; then
	ok "no profile: exit 1 with one clear line"
else
	bad "no profile: exit 1 with one clear line (exit $rc, out: $err)"
fi

printf '\n'
if [ "$fails" -eq 0 ]; then
	printf '\033[32mmaint-scan: all checks passed\033[0m\n'
else
	printf '\033[31mmaint-scan: %d check(s) failed\033[0m\n' "$fails"
fi
exit "$fails"
