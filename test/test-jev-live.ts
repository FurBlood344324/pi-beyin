/**
 * beyin-jev.ts LIVE test — real CommandCode API.
 * Only runs with BEYIN_LIVE=1; makes one small, cheap call.
 */
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockPi, check, section, summary } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

if (process.env.BEYIN_LIVE !== "1") {
	console.log("(live test skipped: run with BEYIN_LIVE=1)");
	process.exit(0);
}

const auth = JSON.parse(readFileSync(path.join(os.homedir(), ".pi", "agent", "auth.json"), "utf8"));
const key: string | undefined = auth?.["command-code"]?.key;
if (!key) {
	console.log("No CommandCode key found (auth.json)");
	process.exit(1);
}

// Isolated HOME so real `~/.config/beyin` key/config files do not affect the test.
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

section("live CommandCode call");
{
	const started = Date.now();
	const r = await classify(
		model,
		{
			state: {
				text: "Bu projede önbellek katmanını Redis ile değiştirmeyi düşünüyoruz.",
				candidates: [{ id: "a", title: "Önbellek notu", statement: "Redis'e geçiş değerlendirmesi" }],
			},
			questions: {
				relevance: { type: "score", instructions: "candidates[0] `text` ile ne kadar ilgili?", criteria: ["İlgisiz", "Arka plan", "Doğrudan ilgili"] },
				approval: { type: "bool", instructions: "Metin onay mı ifade ediyor?", criteria: { true: "Onay", false: "Değil" } },
			},
		},
		{},
	);
	check("stopReason=stop", r.stopReason === "stop", r.errorMessage);
	check("relevance answer returned", r.answers?.relevance?.type === "score", r.answers);
	check("approval answer returned", r.answers?.approval?.type === "bool", r.answers);
	console.log(`  (took ${Date.now() - started}ms, answers: ${JSON.stringify(r.answers)})`);
}

summary();
