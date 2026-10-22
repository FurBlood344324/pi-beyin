#!/usr/bin/env bash
# Test runner for the beyin pi extensions.
# Fast, model-free tests plus optional live CommandCode and real-pi checks.
#
#   ./run.sh              # model-free tests + skeleton checks
#   BEYIN_LIVE=1 ./run.sh # + one real CommandCode API call
#   BEYIN_E2E=1 ./run.sh  # + a real pi session (makes model calls)
#   ./run.sh <dir>        # + the Jev scenario test in that directory (or BEYIN_SCENE_DIR=<dir>)
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT="${BEYIN_VAULT:-$HOME/projects/beyin}"
PATCH_SCRIPT="${BEYIN_PI_PATCH:-$DIR/../tools/pi-harness-patch.py}"
[ -f "$PATCH_SCRIPT" ] || PATCH_SCRIPT="$HOME/.config/beyin/pi-harness/patch.py"

# Jev scenario target: first positional argument or BEYIN_SCENE_DIR
SCENE_DIR="${BEYIN_SCENE_DIR:-}"
if [ "$#" -ge 1 ] && [ "${1#-}" = "$1" ]; then
	SCENE_DIR="$1"
	shift
fi
fails=0

hr() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

hr "1. pi harness patch (beyin.py --harness pi)"
if [ ! -f "$PATCH_SCRIPT" ]; then
	printf '  (skipped — %s not found)\n' "$PATCH_SCRIPT"
else
	PATCH_OUT="$(python3 "$PATCH_SCRIPT" status 2>&1)"
	if printf '%s' "$PATCH_OUT" | grep -q '"status": *"applied"'; then
		ok "patch applied and manifest in sync"
	else
		bad "patch status: $PATCH_OUT"
	fi
fi

hr "2. beyin.py harness registration"
if python3 "$VAULT/beyin.py" context --help 2>&1 | grep -q "pi"; then ok "context --harness pi"; else bad "pi missing from the context harness list"; fi
if python3 "$VAULT/beyin.py" receipt --help 2>&1 | grep -q "pi"; then ok "receipt --harness pi"; else bad "pi missing from the receipt harness list"; fi

hr "3. beyin.py context read (read-only)"
# The query must come from your own vault; the package ships no project-specific phrase.
if [ -z "${BEYIN_TEST_QUERY:-}" ]; then
	printf '  (skipped — set BEYIN_TEST_QUERY to a phrase from your vault)\n'
elif python3 "$VAULT/beyin.py" context --no-sync --json "$BEYIN_TEST_QUERY" 2>/dev/null |
	python3 -c "import json,sys; d=json.load(sys.stdin); n=len(d.get('records',[])); print(f'  \033[32m✓\033[0m {n} records'); assert n>0"; then :; else bad "context returned no records"; fi

hr "3b. vault skills vs package skills"
if [ -d "$VAULT/.agents/skills" ] && [ -n "$(ls -A "$VAULT/.agents/skills" 2>/dev/null)" ]; then
	dupes=""
	for d in "$VAULT/.agents/skills"/*; do
		name="$(basename "$d")"
		[ -f "$DIR/../skills/$name/SKILL.md" ] && dupes="$dupes $name"
	done
	if [ -n "$dupes" ]; then
		printf '  \033[33m!\033[0m duplicate skills in the vault (.agents/skills):%s\n' "$dupes"
		printf '    pi loads both; move the vault copies to a backup (a beyin update can recreate them).\n'
	else
		ok "no package skills duplicated in the vault"
	fi
else
	ok "vault has no .agents/skills copies"
fi

hr "4. unit/integration tests (model-free)"
for t in test-skills test-damitma test-context test-jev test-advisor; do
	printf '\n-- %s --\n' "$t"
	if bun run "$DIR/$t.ts"; then ok "$t passed"; else bad "$t failed (exit $?)"; fi
done

hr "5. live CommandCode (real API)"
if [ "${BEYIN_LIVE:-0}" = "1" ]; then
	if BEYIN_LIVE=1 bun run "$DIR/test-jev-live.ts"; then ok "live Jev passed"; else bad "live Jev failed"; fi
else
	printf '  (skipped — run with BEYIN_LIVE=1 ./run.sh)\n'
fi

hr "6. real pi session E2E"
if [ "${BEYIN_E2E:-0}" = "1" ]; then
	if bash "$DIR/e2e.sh"; then ok "E2E passed"; else bad "E2E failed"; fi
else
	printf '  (skipped — run with BEYIN_E2E=1 ./run.sh)\n'
fi

hr "7. Jev scenario test (directory-based, real pi + CommandCode)"
if [ -n "$SCENE_DIR" ]; then
	printf '  target directory: %s\n' "$SCENE_DIR"
	if bun run "$DIR/test-jev-scenario.ts" "$SCENE_DIR" ${BEYIN_SCENE_TURNS:+"$BEYIN_SCENE_TURNS"}; then
		ok "Jev scenario passed ($SCENE_DIR)"
	else
		bad "Jev scenario failed ($SCENE_DIR)"
	fi
else
	printf '  (skipped — run ./run.sh <dir> or set BEYIN_SCENE_DIR=<dir>)\n'
fi

if [ "$fails" -eq 0 ]; then
	printf '\n\033[32mALL TESTS PASSED\033[0m\n'
else
	printf '\n\033[31m%d test group(s) failed\033[0m\n' "$fails"
fi
exit "$fails"
