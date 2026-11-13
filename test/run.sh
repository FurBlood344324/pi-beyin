#!/usr/bin/env bash
# Test runner for the pi-beyin extensions. Model-free and vault-free: the beyin CLI is replaced by a fake.
#   bash test/run.sh
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fails=0
for t in smoke test-beyin test-batch; do
	printf '\n-- %s --\n' "$t"
	bun run "$DIR/$t.ts" || fails=$((fails + 1))
done
printf '\n'
if [ "$fails" -gt 0 ]; then printf '%s test file(s) failed\n' "$fails"; exit 1; fi
printf 'all test files passed\n'
