#!/usr/bin/env bash
# Beyin ikinci-beyin pi extension'ları için test koşucusu.
# Hızlı ve modelsiz testler + (isteğe bağlı) canlı CommandCode testi.
#
#   ./run.sh              # modelsiz testler + iskelet kontrolleri
#   BEYIN_LIVE=1 ./run.sh # ek olarak gerçek CommandCode API çağrısı
#   BEYIN_E2E=1 ./run.sh  # ek olarak gerçek pi oturumu (model çağrısı yapar)
#   ./run.sh <dizin>      # + Jev senaryo testi o dizinde (ya da BEYIN_SCENE_DIR=<dizin>)
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT="${BEYIN_VAULT:-$HOME/projects/beyin}"
PATCH_SCRIPT="${BEYIN_PI_PATCH:-$DIR/../tools/pi-harness-patch.py}"
[ -f "$PATCH_SCRIPT" ] || PATCH_SCRIPT="$HOME/.config/beyin/pi-harness/patch.py"

# Jev senaryo testi hedef dizini: ilk argüman ya da BEYIN_SCENE_DIR
SCENE_DIR="${BEYIN_SCENE_DIR:-}"
if [ "$#" -ge 1 ] && [ "${1#-}" = "$1" ]; then
	SCENE_DIR="$1"
	shift
fi
fails=0

hr() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }

hr "1. pi harness yaması (beyin.py --harness pi)"
if [ ! -f "$PATCH_SCRIPT" ]; then
	printf '  (atlandı — %s yok)\n' "$PATCH_SCRIPT"
else
	PATCH_OUT="$(python3 "$PATCH_SCRIPT" status 2>&1)"
	if printf '%s' "$PATCH_OUT" | grep -q '"status": *"applied"'; then
		ok "yama uygulanmış ve manifest senkron"
	else
		bad "yama durumu: $PATCH_OUT"
	fi
fi

hr "2. beyin.py harness kaydı"
if python3 "$VAULT/beyin.py" context --help 2>&1 | grep -q "pi"; then ok "context --harness pi"; else bad "context harness listesinde pi yok"; fi
if python3 "$VAULT/beyin.py" receipt --help 2>&1 | grep -q "pi"; then ok "receipt --harness pi"; else bad "receipt harness listesinde pi yok"; fi

hr "3. beyin.py context okuma (salt-okuma)"
if python3 "$VAULT/beyin.py" context --no-sync --json "anomali tespiti PatchCore OCR" 2>/dev/null |
	python3 -c "import json,sys; d=json.load(sys.stdin); n=len(d.get('records',[])); print(f'  \033[32m✓\033[0m {n} kayıt döndü'); assert n>0"; then :; else bad "context kayıt döndürmedi"; fi

hr "4. extension birim/entegrasyon testleri (modelsiz)"
for t in test-damitma test-context test-jev test-advisor; do
	printf '\n-- %s --\n' "$t"
	if bun run "$DIR/$t.ts"; then ok "$t geçti"; else bad "$t başarısız (exit $?)"; fi
done

hr "5. canlı CommandCode (gerçek API)"
if [ "${BEYIN_LIVE:-0}" = "1" ]; then
	if BEYIN_LIVE=1 bun run "$DIR/test-jev-live.ts"; then ok "canlı Jev geçti"; else bad "canlı Jev başarısız"; fi
else
	printf '  (atlandı — BEYIN_LIVE=1 ./run.sh ile çalıştır)\n'
fi

hr "6. gerçek pi oturumu E2E"
if [ "${BEYIN_E2E:-0}" = "1" ]; then
	if bash "$DIR/e2e.sh"; then ok "E2E geçti"; else bad "E2E başarısız"; fi
else
	printf '  (atlandı — BEYIN_E2E=1 ./run.sh ile çalıştır)\n'
fi

hr "7. Jev senaryo testi (dizin tabanlı, gerçek pi + CommandCode)"
if [ -n "$SCENE_DIR" ]; then
	printf '  hedef dizin: %s\n' "$SCENE_DIR"
	if bun run "$DIR/test-jev-scenario.ts" "$SCENE_DIR" ${BEYIN_SCENE_TURNS:+"$BEYIN_SCENE_TURNS"}; then
		ok "Jev senaryo testi geçti ($SCENE_DIR)"
	else
		bad "Jev senaryo testi başarısız ($SCENE_DIR)"
	fi
else
	printf '  (atlandı — ./run.sh <dizin> ya da BEYIN_SCENE_DIR=<dizin> ile çalıştır)\n'
fi

if [ "$fails" -eq 0 ]; then
	printf '\n\033[32mTÜM TESTLER GEÇTİ\033[0m\n'
else
	printf '\n\033[31m%d test grubu başarısız\033[0m\n' "$fails"
fi
exit "$fails"
