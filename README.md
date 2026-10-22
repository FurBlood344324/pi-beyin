# pi-beyin

[pi](https://pi.dev) için ikinci beyin (beyin vault) köprüsü. Üç extension tek pakette gelir:

| Extension | Ne yapar |
|---|---|
| `context.ts` | Her istemde vault'tan ilgili notları bağlama enjekte eder; kayıt düşülmeyen turdan sonra receipt hatırlatması verir. `beyin_jev_memory` / `beyin_jev_review` / `beyin_jev_answer` danışman araçlarını kaydeder. |
| `damitma.ts` | Vault'a kayıt düşüldüğü halde `knowledge/` altına damıtılmadıysa tur sonunda **öneri** sunar (otomatik yazmaz). `/damitma` komutu. |
| `jev.ts` | CommandCode `typesafe/jev` karar modelini pi'ye classifier olarak bağlar. `/jev-test` komutu. |

Hepsi **fail-open**: hata turu bozmaz, yalnız o turun katkısı sessizce gelmez. Vault'tan gelen
içerik **veri**dir; talimat olarak yorumlanmaz.

## Gereksinimler

- pi (`@earendil-works/pi-coding-agent`)
- `python3` ve `beyin.py` içeren bir vault (varsayılan `~/projects/beyin`, `BEYIN_VAULT` ile değişir)
- İsteğe bağlı: `~/.config/beyin/pi-hook.json`, `damitma.json`, `jev.json`

## Kurulum

```bash
# yerel geliştirme (kopyalanmaz, doğrudan düzenlenir)
pi install ~/projects/pi-beyin

# sürümlenmiş (git tag)
pi install git:github.com/FurBlood344324/pi-beyin@v0.1.0

# npm
pi install npm:pi-beyin
```

> Eski kurulumdan geçiyorsan `~/.pi/agent/extensions/beyin-*.ts` dosyalarını **kaldır**.
> Aksi halde extension'lar iki kez yüklenir (çift bağlam enjeksiyonu / çift hatırlatma).

Tek tek kapatmak için settings'te paket filtresi kullanılabilir:

```json
{
  "packages": [
    {
      "source": "npm:pi-beyin",
      "extensions": ["extensions/*.ts", "!extensions/damitma.ts"]
    }
  ]
}
```

## Yapılandırma

### Dosyalar

| Dosya | İçerik |
|---|---|
| `~/.config/beyin/pi-hook.json` | `excludeProjects` (beyin'in sustuğu projeler), `injectionOnly.<proje>` → `{ reminders, damitma }` |
| `~/.config/beyin/damitma.json` | `{ enabled, cooldownMinutes, maxCandidates }` |
| `~/.config/beyin/jev.json` | `{ enabled, mode: "on" \| "shadow", model, minScore, maxCandidates }` |
| `~/.config/beyin/jev-commandcode.env` | `CMD_API_KEY=...` (registry anahtarı yoksa) |

### Ortam değişkenleri

- `BEYIN_VAULT` (vars. `~/projects/beyin`), `BEYIN_PYTHON` (vars. `python3`)
- `BEYIN_HOOK_CONFIG`, `BEYIN_DAMITMA_CONFIG`, `BEYIN_JEV_CONFIG`, `BEYIN_DAMITMA`(=0 kapat), `BEYIN_JEV`(=0 kapat)
- `BEYIN_CONTEXT_CHARS` (vars. 4000), `BEYIN_REMINDERS`(=0 kapat), `BEYIN_INCLUDE_VAULT`(=1 vault içinde de enjekte et)
- `BEYIN_DISABLE`(=1 hepsi sussun), `BEYIN_DEBUG`(=1 stderr tanılama)
- `BEYIN_JEV_MODEL`, `BEYIN_JEV_API_KEY` / `CMD_API_KEY` / `COMMAND_CODE_API_KEY`
- `BEYIN_FORCE_REMINDER`(=1 hatırlatmayı zorla; E2E testinde kullanılır)

## Geliştirme

```bash
bun run test        # modelsiz testler (vault salt-okuma)
bun run smoke       # üç modülün import edilebildiğini doğrular
bun run typecheck   # tsc --noEmit
BEYIN_LIVE=1 bash test/run.sh   # + gerçek CommandCode çağrısı
BEYIN_E2E=1 bash test/run.sh    # + gerçek pi oturumu (model çağrısı yapar)

# Jev senaryo testi: verilen dizinde gerçek pi oturumu, çok turlu.
# Dizin yoksa bu adım sessizce atlanır (hata sayılmaz).
bash test/run.sh ~/projects/work
bun run test/test-jev-scenario.ts ~/projects/work 3
BEYIN_SCENE_DIR=~/projects/work BEYIN_SCENE_TURNS=3 bun run test/test-jev-scenario.ts
```

Senaryo testi `pi --mode rpc --no-session --no-tools` ile çalışır (vault'a yazmaz) ve Jev'in arka plan
puanlamasını bekler; `jev.json` kapalıysa yalnız enjeksiyonu doğrular. Süre/gecikme `BEYIN_SCENE_WAIT_MS`
(vars. 30 sn) ile ayarlanır.

Testler repodaki fixture'ları değiştirmez; her koşum kendi geçici dizininde çalışır.
`test/run.sh` içindeki 1–3. adımlar canlı vault'a bakar; bunlar için `BEYIN_VAULT` doğru olmalı.

## Lisans

MIT
