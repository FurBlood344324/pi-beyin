/**
 * beyin-jev.ts tests.
 * CommandCode `provider/v1/systemone` (typesafe/jev) is mocked; native question/answer conversion
 * and the error paths are verified.
 */
import * as fs from "node:fs";
import { MockPi, check, section, summary } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

const TEST_HOME = tmpDir("pi-beyin-home-");
fs.mkdirSync(TEST_HOME, { recursive: true });

process.env.HOME = TEST_HOME;
process.env.BEYIN_DEBUG = "1";
delete process.env.BEYIN_JEV_MODEL;
delete process.env.BEYIN_JEV_API_KEY;
delete process.env.CMD_API_KEY;
delete process.env.COMMAND_CODE_API_KEY;

const { default: factory } = await import(extensionUrl("jev"));

const pi = new MockPi();
factory(pi);

const PROVIDER = "beyin-jev";
const API = "beyin-jev-system-one";
const provider = pi.providers.get(PROVIDER);
const classify = provider?.classifiers?.[API]?.classify;
const model = { id: "jev-commandcode", api: API };

let lastReq: { url: string; init: any } | undefined;
function mockFetch(body: any, status = 200): void {
	globalThis.fetch = (async (url: any, init: any) => {
		lastReq = { url: String(url), init };
		const payload = typeof body === "string" ? body : JSON.stringify(body);
		return new Response(payload, { status, headers: { "content-type": "application/json" } });
	}) as any;
}

async function setKey(key: string | undefined): Promise<void> {
	await pi.fire("session_start", {}, { modelRegistry: { getApiKeyForProvider: async () => key } });
}

const questions = {
	q_choice: { type: "choice", criteria: { yes: "evet", no: "hayır" } },
	q_score: { type: "score", criteria: ["a", "b", "c"] },
	q_bool: { type: "bool", criteria: { true: "t", false: "f" } },
};

section("provider registration");
check("provider registered", !!provider);
check("classifier function exists", typeof classify === "function");
check("model list correct", provider?.models?.[0]?.id === model.id && provider?.models?.[0]?.type === "classifier");
check("baseUrl provider/v1", provider?.baseUrl === "https://api.commandcode.ai/provider/v1");
check("endpoint commandcode", provider?.baseUrl?.startsWith("https://api.commandcode.ai"));
check("/jev-test command exists", pi.commands.has("jev-test"));

section("native systemone conversion and normalization");
{
	await setKey("test-key");
	mockFetch({
		model: "typesafe/jev",
		answers: {
			q_choice: { type: "choice", choice: "yes", confidence: 0.8, probabilities: { yes: 0.9, no: 0.1 } },
			q_score: { type: "score", score: 1.86, confidence: 0.79, probabilities: { 0: 0.01, 1: 0.12, 2: 0.87 } },
			q_bool: { type: "noul", noul: 0.87 },
		},
		usage: { input_tokens: 42, output_tokens: 12 },
	});
	const r = await classify(model, { state: { text: "x" }, questions }, {});
	check("stopReason=stop", r.stopReason === "stop", r.errorMessage);
	check("choice selected", r.answers.q_choice?.choice === "yes");
	check("choice probabilities normalized", Math.abs(r.answers.q_choice?.probabilities?.yes - 0.9) < 1e-6);
	check("score preserved (native float)", Math.abs(r.answers.q_score?.score - 1.86) < 1e-6, r.answers.q_score);
	check("noul -> bool probability", Math.abs(r.answers.q_bool?.probability - 0.87) < 1e-6 && r.answers.q_bool?.type === "bool");
	check("request went to the systemone endpoint", lastReq?.url === "https://api.commandcode.ai/provider/v1/systemone", lastReq?.url);
	check("Authorization header present", /Bearer test-key/.test(lastReq?.init?.headers?.Authorization ?? ""));
	const sent = JSON.parse(lastReq?.init?.body ?? "{}");
	check("model=typesafe/jev", sent.model === "typesafe/jev", sent.model);
	check("bool question sent as native 'noul'", sent.questions?.q_bool?.type === "noul", sent.questions?.q_bool);
	check("score question sent with criteria", Array.isArray(sent.questions?.q_score?.criteria));
}
{
	await setKey("test-key");
	mockFetch({ model: "typesafe/jev", answers: { q_score: { type: "score", score: 0 } } });
	const r = await classify(model, { state: {}, questions: { q_score: questions.q_score } }, {});
	check("score=0 preserved", r.stopReason === "stop" && r.answers.q_score?.score === 0, r.errorMessage);
}
{
	await setKey("test-key");
	// Without a `score` field, the expected value is derived from the probabilities
	mockFetch({ answers: { q_score: { type: "score", probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } } } });
	const r = await classify(model, { state: {}, questions: { q_score: questions.q_score } }, {});
	check("score derived from probabilities when missing (~1.6)", Math.abs((r.answers.q_score?.score ?? 0) - 1.6) < 1e-6, r.answers.q_score);
}
{
	await setKey("test-key");
	mockFetch({ error: { message: "bad" } });
	const r = await classify(model, { state: {}, questions: { q_score: questions.q_score } }, {});
	check("returns error when answers are missing", r.stopReason === "error", r.stopReason);
}

section("error paths");
{
	await setKey(undefined);
	mockFetch({ answers: {} });
	const r = await classify(model, { state: {}, questions }, {});
	check("no key → error", r.stopReason === "error");
	check("key error message ('anahtar')", /anahtar/i.test(r.errorMessage ?? ""), r.errorMessage);
}
{
	await setKey("test-key");
	mockFetch("upstream patladı", 500);
	const r = await classify(model, { state: {}, questions }, {});
	check("HTTP 500 → error", r.stopReason === "error");
	check("HTTP code in message", /HTTP 500/.test(r.errorMessage ?? ""), r.errorMessage);
}
{
	await setKey("test-key");
	const r = await classify(model, { state: {}, questions }, { signal: { aborted: true } });
	check("abort → aborted", r.stopReason === "aborted");
}
{
	await setKey("test-key");
	mockFetch({ answers: {} });
	const r = await classify(model, { state: {}, questions: {} }, {});
	check("no questions → empty answer (stop)", r.stopReason === "stop" && Object.keys(r.answers).length === 0);
}

section("/jev-test command");
{
	const notes: any[] = [];
	const ctx = {
		ui: { notify: (m: string, l?: string) => notes.push({ m, l }) },
		modelRegistry: {
			findOfType: () => model,
			classify: async () => ({ stopReason: "stop", answers: { relevance: { type: "score", score: 2 } } }),
		},
	};
	await pi.commands.get("jev-test").handler("deneme", ctx);
	check("answer reported", notes.some((n) => /Jev cevapları/.test(n.m)) || notes.some((n) => /Jev hata/.test(n.m)), notes);
}
{
	const notes: any[] = [];
	const ctx = { ui: { notify: (m: string, l?: string) => notes.push({ m, l }) }, modelRegistry: { findOfType: () => undefined } };
	await pi.commands.get("jev-test").handler("", ctx);
	check("notifies error when the classifier is missing", notes.some((n) => /bulunamadı/.test(n.m)), notes);
}

summary();
