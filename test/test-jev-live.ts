/**
 * beyin-jev.ts CANLI testi — gerçek CommandCode API'si.
 * Yalnızca BEYIN_LIVE=1 iken çalışır; küçük ve ucuz tek bir çağrı yapar.
 */
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockPi, check, section, summary } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

if (process.env.BEYIN_LIVE !== "1") {
	console.log("(canlı test atlandı: BEYIN_LIVE=1 ile çalıştır)");
	process.exit(0);
}

const auth = JSON.parse(readFileSync(path.join(os.homedir(), ".pi", "agent", "auth.json"), "utf8"));
const key: string | undefined = auth?.["command-code"]?.key;
if (!key) {
	console.log("CommandCode anahtarı bulunamadı (auth.json)");
	process.exit(1);
}

// İzole HOME: gerçek `~/.config/beyin` anahtar/config dosyaları testi etkilemesin.
process.env.HOME = tmpDir("pi-beyin-home-");
process.env.BEYIN_DEBUG = "1";

const { default: factory } = await import(extensionUrl("jev"));
const pi = new MockPi();
factory(pi);
await pi.fire("session_start", {}, { modelRegistry: { getApiKeyForProvider: async () => key } });

const provider = pi.providers.get("beyin-jev");
const API = "beyin-jev-system-one";
const classify = provider.classifiers[API].classify;
const model = { id: "jev-commandcode", api: API };

section("canlı CommandCode çağrısı");
{
	const started = Date.now();
	const r = await classify(
		model,
		{
			state: {
				text: "Görüntü işleme stajında anomali tespiti için PatchCore kullanıyoruz.",
				candidates: [{ id: "a", title: "CV stajı", statement: "Anomali tespiti ve OCR" }],
			},
			questions: {
				relevance: { type: "score", instructions: "candidates[0] `text` ile ne kadar ilgili?", criteria: ["İlgisiz", "Arka plan", "Doğrudan ilgili"] },
				approval: { type: "bool", instructions: "Metin onay mı ifade ediyor?", criteria: { true: "Onay", false: "Değil" } },
			},
		},
		{},
	);
	check("stopReason=stop", r.stopReason === "stop", r.errorMessage);
	check("relevance cevabı geldi", r.answers?.relevance?.type === "score", r.answers);
	check("approval cevabı geldi", r.answers?.approval?.type === "bool", r.answers);
	console.log(`  (süre: ${Date.now() - started}ms, cevaplar: ${JSON.stringify(r.answers)})`);
}

summary();
