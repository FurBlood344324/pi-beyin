#!/usr/bin/env bash
# Gerçek pi oturumu E2E testi (model çağrısı yapar).
#  - vault dışı bir projede ikinci beyin bağlamı enjekte ediliyor mu?
#  - receipt hatırlatması sistem prompt'una giriyor mu?
set -uo pipefail

MODEL="${BEYIN_E2E_MODEL:-command-code/deepseek/deepseek-v4.1-flash-fast}"
WORKDIR="$(mktemp -d /tmp/beyin-e2e.XXXXXX)"
SESSDIR="$WORKDIR/sessions"
fails=0
# Başarılı koşuda geçici dizini sil; başarısızda inceleme için bırak (yol son satırda yazılır).
cleanup() { [ "$fails" -eq 0 ] && rm -rf "$WORKDIR"; }
trap cleanup EXIT
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }

# --- 1. bağlam enjeksiyonu ---
cd "$WORKDIR"
# --no-tools: uzantılar yine yüklenir ama model araç çağıramaz → E2E vault'a yazmaz.
if timeout 150 pi -p --mode json --no-session --no-tools --model "$MODEL" "Tek kelimeyle yanıtla: evet" > ctx.jsonl 2>ctx.err; then
	if grep -q '"customType": *"beyin-context"' ctx.jsonl; then ok "beyin-context mesajı enjekte edildi"; else fail "beyin-context mesajı yok"; fi
	if grep -q "İkinci beyin" ctx.jsonl; then ok "bağlam gövdesi mevcut"; else fail "bağlam gövdesi yok"; fi
else
	fail "pi (bağlam) exit != 0"
fi

# --- 2. receipt hatırlatması -> sistem prompt bölümü ---
# --no-tools olmadan reminder'ı gören model vault'a note/receipt yazıyordu (test sızıntısı).
if BEYIN_FORCE_REMINDER=1 timeout 150 pi -p --mode json --no-tools --session-dir "$SESSDIR" --model "$MODEL" "Tek kelimeyle yanıtla: tamam" > rem.jsonl 2>rem.err; then
	if grep -q "kayıt gerekli" rem.jsonl; then ok "receipt hatırlatması sistem prompt'una girdi"; else fail "hatırlatma yok"; fi
	SFILE="$(find "$SESSDIR" -type f -name '*.jsonl' | head -1)"
	if [ -n "$SFILE" ] && grep -q '<beyin_kayit>' "$SFILE"; then ok "<beyin_kayit> bölümü sistem mesajında"; else fail "<beyin_kayit> bölümü session'da yok"; fi
else
	fail "pi (hatırlatma) exit != 0"
fi

echo "  (çalışma dizini: $WORKDIR)"
exit "$fails"
