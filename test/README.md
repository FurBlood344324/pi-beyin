# Beyin pi extension testleri

Beyin ikinci-beyin köprüsünü pi'de sağlayan extension'ların (`extensions/context.ts`,
`extensions/damitma.ts`, `extensions/jev.ts`) test takımı.

## Çalıştırma

```bash
./run.sh                 # modelsiz: harness + birim/entegrasyon (hızlı)
BEYIN_LIVE=1 ./run.sh    # + gerçek CommandCode API çağrısı (küçük)
BEYIN_E2E=1 ./run.sh     # + gerçek pi oturumu (model çağrısı yapar)
./run.sh <dizin>         # + Jev senaryo testi o dizinde (ya da BEYIN_SCENE_DIR=<dizin>)
```

Jev senaryo testi (dizin tabanlı, çok turlu):

```bash
./run.sh /home/furblood/projects/work
BEYIN_SCENE_DIR=/home/furblood/projects/work BEYIN_SCENE_TURNS=3 ./run.sh
bun run test-jev-scenario.ts /home/furblood/projects/work 3
```

Tek tek:

```bash
bun run test-damitma.ts
bun run test-context.ts
bun run test-jev.ts
BEYIN_LIVE=1 bun run test-jev-live.ts
bash e2e.sh
```

## Neyi kapsar

| Dosya | Kapsam |
|---|---|
| `test-damitma.ts` | Öneri koşulları (kayıt var/knowledge yok), atlama (vault/work/aborted/cooldown), **izole hook config** (`hook.test.json`: `excludeProjects` + `injectionOnly.damitma=true`), `/damitma` |
| `test-context.ts` | Gerçek `beyin.py context` enjeksiyonu, atlama koşulları, receipt hatırlatması → sistem prompt bölümü, Jev önbellek filtresi + fail-open |
| `test-jev.ts` | Provider kaydı, JSON çözümleme/normalizasyon (choice/score/bool), hata yolları (anahtar/HTTP/abort), `/jev-test` |
| `test-advisor.ts` | Danışman araçları (`beyin_jev_review/answer/memory`) kaydı, silent-mod kapısı, JSON stdin köprüsü (yerel doğrulama hataları; uzak çağrı yok) |
| `test-jev-live.ts` | Gerçek CommandCode uçtan uca (yalnız `BEYIN_LIVE=1`) |
| `e2e.sh` | Gerçek pi oturumunda bağlam + hatırlatma (yalnız `BEYIN_E2E=1`) |
| `test-jev-scenario.ts` | **Verilen dizinde** gerçek pi + çok turlu: enjeksiyon + Jev arka plan puanlamasının tamamlandığı (abort/timeout regresyonu) |
| `run.sh` | Hepsini + pi-harness yamasını koşar |

## Notlar

- `harness.ts` pi API'sini taklit eder; gerçek `beyin.py` komutları çalışır.
- **Config izolasyonu:** testler canlı `~/.config/beyin/*.json`'ı okumaz; her koşum `test/fixtures.ts` ile
  kendi geçici dizinini kurar ve fixture'ları oraya kopyalar. 2026-10-17: canlı `pi-hook.json`'a bağımlı
  olduğu için `test-damitma` "work'te öneri yok" testi bayatladı.
- Jev testleri taze modül örneği (`?fresh=N` cache-bust) kullanır. Cache-bust için **mutlak yol** gerekir:
  Bun `file://` URL'lerinde sorgu dizesini yok sayar ve aynı modül örneğini döndürür (ölçüldü).
- Testler vault'a yazmaz; yalnız salt-okuma `context`/`doctor` çağırır.
- Çıktıdaki `[beyin]`/`[beyin-damitma]`/`[beyin-jev]` satırları `BEYIN_DEBUG=1` tanılamasıdır.
