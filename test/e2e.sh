#!/usr/bin/env bash
# Real pi session E2E test (makes model calls).
#  - is the second-brain context injected in a project outside the vault?
#  - does the receipt reminder reach the system prompt section?
#
# Assertions match the Turkish default texts; the body check accepts the English
# build too, so BEYIN_LANG=en does not turn this into a false failure.
set -uo pipefail

MODEL="${BEYIN_E2E_MODEL:-command-code/deepseek/deepseek-v4.1-flash-fast}"
WORKDIR="$(mktemp -d /tmp/beyin-e2e.XXXXXX)"
SESSDIR="$WORKDIR/sessions"
fails=0
# Delete the temp dir on success; keep it for inspection on failure (path printed at the end).
cleanup() { [ "$fails" -eq 0 ] && rm -rf "$WORKDIR"; }
trap cleanup EXIT
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }

# --- 1. context injection ---
cd "$WORKDIR"
# --no-tools: extensions still load but the model cannot call tools -> E2E never writes to the vault.
if timeout 150 pi -p --mode json --no-session --no-tools --model "$MODEL" "Answer with one word: yes" > ctx.jsonl 2>ctx.err; then
	if grep -q '"customType": *"beyin-context"' ctx.jsonl; then ok "beyin-context message injected"; else fail "no beyin-context message"; fi
	if grep -qE "İkinci beyin|Second brain" ctx.jsonl; then ok "context body present"; else fail "no context body"; fi
else
	fail "pi (context) exit != 0"
fi

# --- 2. receipt reminder -> system prompt section ---
# Without --no-tools the model saw the reminder and wrote a note/receipt into the vault (test leak).
if BEYIN_FORCE_REMINDER=1 timeout 150 pi -p --mode json --no-tools --session-dir "$SESSDIR" --model "$MODEL" "Answer with one word: ok" > rem.jsonl 2>rem.err; then
	if grep -qE "kayıt gerekli|record required" rem.jsonl; then ok "receipt reminder reached the system prompt"; else fail "no reminder"; fi
	SFILE="$(find "$SESSDIR" -type f -name '*.jsonl' | head -1)"
	if [ -n "$SFILE" ] && grep -q '<beyin_kayit>' "$SFILE"; then ok "<beyin_kayit> section in the system message"; else fail "<beyin_kayit> section missing from the session"; fi
else
	fail "pi (reminder) exit != 0"
fi

echo "  (working directory: $WORKDIR)"
exit "$fails"
