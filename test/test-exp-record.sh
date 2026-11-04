#!/usr/bin/env bash
# exp-record tool test: the built-in self-test plus one fixture project in a temp dir.
# No vault, no model calls. Run: bash test/test-exp-record.sh
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="$DIR/../tools/exp-record"
fails=0
ok() { printf '  \033[32m\u2713\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m\u2717\033[0m %s\n' "$1"; fails=$((fails + 1)); }
hr() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

hr "exp-record: file and --help"
if [ -f "$TOOL" ]; then ok "tools/exp-record exists"; else bad "tools/exp-record is missing"; fi
if [ -f "$TOOL" ] && bash "$TOOL" --help >/dev/null 2>&1; then ok "--help exits 0"; else bad "--help exits 0"; fi

hr "exp-record: --self-test"
if [ -f "$TOOL" ] && bash "$TOOL" --self-test; then ok "--self-test passed"; else bad "--self-test failed"; fi

hr "exp-record: fixture project"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROJ="$TMP/proj"
mkdir -p "$PROJ/.pi" "$PROJ/logs" "$PROJ/sub/deep"
cat > "$PROJ/.pi/beyin-project.json" <<JSON
{
  "name": "fixture",
  "root": "$PROJ",
  "logs": "logs",
  "log_index": "logs/index.md",
  "scopes": ["product", "harness"],
  "hardware": "fixture box"
}
JSON

n="$(cd "$PROJ/sub/deep" && bash "$TOOL" next 2>&1)"
[ "$n" = "0001" ] && ok "next from a subdirectory: 0001" || bad "next from a subdirectory (got '$n')"

out="$(cd "$PROJ" && bash "$TOOL" new --title "Batch 8 OOM" --scope product 2>&1)"
if [ -f "$PROJ/logs/0001-batch-8-oom.md" ]; then ok "new created logs/0001-batch-8-oom.md"; else bad "new created the record (out: $out)"; fi
grep -q '^- \*\*Scope:\*\* product$' "$PROJ/logs/0001-batch-8-oom.md" && ok "record carries the scope" || bad "record carries the scope"
grep -q '^- \*\*Hardware:\*\* fixture box$' "$PROJ/logs/0001-batch-8-oom.md" && ok "record prefills the profile hardware" || bad "record prefills the profile hardware"
grep -q '| 0001 | Batch 8 OOM |' "$PROJ/logs/index.md" && ok "index has a row for 0001" || bad "index has a row for 0001"

n="$(cd "$PROJ" && bash "$TOOL" next 2>&1)"
[ "$n" = "0002" ] && ok "next after one record: 0002" || bad "next after one record (got '$n')"

cp "$PROJ/logs/index.md" "$TMP/index.before"
(cd "$PROJ" && bash "$TOOL" index >/dev/null 2>&1)
cmp -s "$TMP/index.before" "$PROJ/logs/index.md" && ok "index is idempotent" || bad "index is idempotent"

(cd "$PROJ" && bash "$TOOL" check >/dev/null 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "check exits 1 on a fresh record" || bad "check exits 1 on a fresh record (exit $rc)"
out="$(cd "$PROJ" && bash "$TOOL" check 2>&1)"
printf '%s' "$out" | grep -q 'Seed(empty)' && ok "check names the empty field" || bad "check names the empty field (out: $out)"

REC="$PROJ/logs/0001-batch-8-oom.md"
for pair in "Goal / hypothesis|first run" "Dataset|toy 120 images" "Model / backbone|yolo-n" "Seed|42" "Duration|3m"; do
	label="${pair%%|*}"
	value="${pair#*|}"
	awk -v label="$label" -v value="$value" '
		{ if ($0 == "- **" label ":**") print "- **" label ":** " value; else print }
	' "$REC" > "$REC.new" && mv "$REC.new" "$REC"
done
(cd "$PROJ" && bash "$TOOL" check >/dev/null 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "check exits 0 when the fields are filled" || bad "check exits 0 when the fields are filled (exit $rc)"

out="$(cd "$PROJ" && bash "$TOOL" new --title "bad scope" --scope nowhere 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'unknown scope' && [ ! -e "$PROJ/logs/0002-bad-scope.md" ]; then
	ok "new refuses a scope outside the profile"
else
	bad "new refuses a scope outside the profile (exit $rc, out: $out)"
fi

mkdir -p "$TMP/nowhere"
err="$(cd "$TMP/nowhere" && bash "$TOOL" next 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$err" | grep -q 'beyin-project.json' && [ "$(printf '%s\n' "$err" | wc -l | tr -d ' ')" = "1" ]; then
	ok "no profile: exit 1 with one clear line"
else
	bad "no profile: exit 1 with one clear line (exit $rc, out: $err)"
fi

printf '\n'
if [ "$fails" -eq 0 ]; then
	printf '\033[32mexp-record: all checks passed\033[0m\n'
else
	printf '\033[31mexp-record: %d check(s) failed\033[0m\n' "$fails"
fi
exit "$fails"
