/**
 * Beyin Jev — pi-native classifier backed by CommandCode.
 *
 * Jev is CommandCode's **decision model** `typesafe/jev` (TypeSafe Jev, served by CommandCode).
 * NOT a chat model: it takes `state` + typed questions (noul/choice/score) and returns
 * **probabilities**. Endpoint: CommandCode `provider/v1/systemone`. It is invisible in
 * `/model`; headless/provider API only.
 *
 * - No local server, no protocol bridge.
 * - Used via `ctx.modelRegistry.findOfType("classifier", "beyin-jev", "jev-commandcode")`
 *   and `ctx.modelRegistry.classify(model, { state, questions })`.
 * - The `/jev-test` command does a quick trial run.
 *
 * UNAFFECTED by beyin updates: this file ships with the pi-beyin package, outside the vault.
 *
 * Key resolution (first hit wins):
 *   1) pi model registry -> "command-code" provider key (standard; does not touch auth.json)
 *   2) BEYIN_JEV_API_KEY / CMD_API_KEY / COMMAND_CODE_API_KEY env var
 *   3) ~/.config/beyin/jev-commandcode.env  (line: CMD_API_KEY=...)
 *
 * Configuration: ~/.config/beyin/jev.json  { enabled, mode, model, minScore }
 *   BEYIN_JEV_MODEL env var overrides the model. Default model: `typesafe/jev`.
 *
 * NOTE: CommandCode/Cloudflare blocks the `Python-urllib` UA with 403 (1010); that is why
 * `User-Agent: openai-node/4.0.0` is required. `globalThis.fetch` must be used (the pi
 * wrapper does not work).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HOME = process.env.HOME || "";
const PROVIDER = "beyin-jev";
const MODEL_ID = "jev-commandcode";
const API = "beyin-jev-system-one";
const BASE_URL = "https://api.commandcode.ai/provider/v1";
const ENDPOINT = BASE_URL + "/systemone";
const DEFAULT_MODEL = "typesafe/jev";
const KEY_FILE = path.join(HOME, ".config", "beyin", "jev-commandcode.env");
const CONFIG_FILE = path.join(HOME, ".config", "beyin", "jev.json");
const DEBUG = process.env.BEYIN_DEBUG === "1";

// Latest session context, needed to use pi's auth API (without touching auth.json directly).
let latestContext: ExtensionContext | undefined;

function debug(msg: string): void {
	if (DEBUG) process.stderr.write(`[beyin-jev] ${msg}\n`);
}

interface JevConfig {
	enabled: boolean;
	mode: "on" | "shadow";
	model: string;
	minScore: number;
	maxCandidates: number;
}

function loadConfig(): JevConfig {
	const defaults: JevConfig = { enabled: false, mode: "on", model: DEFAULT_MODEL, minScore: 1, maxCandidates: 8 };
	let fromFile: Partial<JevConfig> = {};
	try {
		if (fs.existsSync(CONFIG_FILE)) fromFile = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
	} catch (err) {
		debug(`config okunamadı: ${String(err)}`);
	}
	const model = process.env.BEYIN_JEV_MODEL || fromFile.model || defaults.model;
	return {
		enabled: fromFile.enabled ?? defaults.enabled,
		mode: fromFile.mode === "shadow" ? "shadow" : "on",
		model,
		minScore: typeof fromFile.minScore === "number" ? fromFile.minScore : defaults.minScore,
		maxCandidates: typeof fromFile.maxCandidates === "number" ? fromFile.maxCandidates : defaults.maxCandidates,
	};
}

function parseEnvFile(file: string, names: string[]): string | undefined {
	try {
		if (!fs.existsSync(file)) return undefined;
		for (const line of fs.readFileSync(file, "utf8").split("\n")) {
			const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
			if (!m || !names.includes(m[1])) continue;
			let v = m[2];
			if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[0] === v[v.length - 1]) v = v.slice(1, -1);
			if (v) return v;
		}
	} catch (err) {
		debug(`env dosyası okunamadı: ${String(err)}`);
	}
	return undefined;
}

function resolveKey(): string | undefined {
	for (const name of ["BEYIN_JEV_API_KEY", "CMD_API_KEY", "COMMAND_CODE_API_KEY"]) {
		const v = process.env[name];
		if (v) return v;
	}
	const fromFile = parseEnvFile(KEY_FILE, ["BEYIN_JEV_API_KEY", "CMD_API_KEY", "COMMAND_CODE_API_KEY"]);
	if (fromFile) return fromFile;
	return undefined;
}

/**
 * Standard path: ask pi's model registry for the "command-code" provider key.
 * That way the extension never reads auth.json itself; credential resolution belongs to pi.
 */
async function resolveApiKey(): Promise<string | undefined> {
	if (latestContext) {
		try {
			const key = await latestContext.modelRegistry.getApiKeyForProvider("command-code");
			if (key) return key;
		} catch (err) {
			debug(`registry anahtar çözümü başarısız: ${String(err)}`);
		}
	}
	return resolveKey();
}

function clamp01(v: unknown, fallback = 0.5): number {
	const n = typeof v === "number" ? v : Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(0, Math.min(1, n));
}

/** Expected score = weighted mean of the probability distribution (fallback when there is no native `score`). */
function expectedScore(distribution: unknown): number {
	if (!distribution || typeof distribution !== "object") return NaN;
	let sum = 0;
	let weight = 0;
	for (const [k, v] of Object.entries(distribution as Record<string, unknown>)) {
		const i = Number(k);
		const p = Number(v);
		if (Number.isFinite(i) && Number.isFinite(p)) {
			sum += i * p;
			weight += p;
		}
	}
	return weight > 0 ? sum / weight : NaN;
}

/**
 * Map our question types to native systemone types: `bool` -> `noul`; `score`/`choice` unchanged.
 * `criteria` only applies to score/choice (noul is yes/no).
 */
function toNativeQuestions(questions: Record<string, any>): Record<string, any> {
	const out: Record<string, any> = {};
	for (const [qid, q] of Object.entries(questions)) {
		if (!q || typeof q !== "object") continue;
		if (q.type === "bool" || q.type === "noul") {
			out[qid] = { type: "noul", instructions: q.instructions ?? "Answer yes or no." };
		} else if (q.type === "score" || q.type === "choice") {
			const item: Record<string, any> = { type: q.type, instructions: q.instructions ?? "" };
			if (q.criteria !== undefined) item.criteria = q.criteria;
			out[qid] = item;
		} else {
			out[qid] = q;
		}
	}
	return out;
}

/** Map a native systemone response back to our contract (`noul` -> `bool`; score/choice normalized). */
function normalizeNativeAnswers(questions: Record<string, any>, raw: any): Record<string, any> {
	const answers: Record<string, any> = {};
	for (const [qid, q] of Object.entries(questions)) {
		const a = raw?.[qid];
		if (!a || typeof a !== "object") continue;
		if (q.type === "bool" || q.type === "noul") {
			const p = clamp01(a.noul, NaN);
			if (!Number.isFinite(p)) continue;
			answers[qid] = { type: "bool", probability: p };
		} else if (q.type === "score") {
			let s = Number(a.score);
			if (!Number.isFinite(s)) s = expectedScore(a.probabilities);
			if (!Number.isFinite(s)) continue;
			s = Math.max(0, Math.min(2, s));
			answers[qid] = { type: "score", score: s, confidence: clamp01(a.confidence, 0.6) };
		} else if (q.type === "choice") {
			const keys = Object.keys(q.criteria ?? {});
			const probs = a.probabilities && typeof a.probabilities === "object" ? a.probabilities : {};
			let choice = typeof a.choice === "string" && keys.includes(a.choice) ? a.choice : undefined;
			if (!choice && keys.length > 0) {
				choice = keys.slice().sort((x, y) => (Number(probs[y]) || 0) - (Number(probs[x]) || 0))[0];
			}
			if (!choice) continue;
			const distribution: Record<string, number> = {};
			let sum = 0;
			for (const k of keys) {
				const v = clamp01(probs[k], 0);
				distribution[k] = v;
				sum += v;
			}
			if (sum > 0) for (const k of keys) distribution[k] = distribution[k] / sum;
			else distribution[choice] = 1;
			answers[qid] = {
				type: "choice",
				choice,
				confidence: clamp01(a.confidence, distribution[choice] ?? 0.6),
				probabilities: distribution,
			};
		}
	}
	return answers;
}

function errorResult(model: any, message: string, stopReason: "error" | "aborted"): any {
	return {
		api: model?.api ?? API,
		provider: PROVIDER,
		model: model?.id ?? MODEL_ID,
		answers: {},
		stopReason,
		errorMessage: message,
		timestamp: Date.now(),
	};
}

export default function beyinJev(pi: ExtensionAPI) {
	const config = loadConfig();

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		latestContext = ctx;
	});

	pi.registerProvider(PROVIDER, {
		name: "Beyin Jev (CommandCode typesafe/jev)",
		baseUrl: BASE_URL,
		apiKey: "unused-static-placeholder",
		models: [
			{
				type: "classifier",
				id: MODEL_ID,
				name: "Jev (CommandCode typesafe/jev)",
				api: API,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 32768,
			},
		],
		classifiers: {
			[API]: {
				async classify(model: any, context: any, options?: any): Promise<any> {
					if (options?.signal?.aborted) return errorResult(model, "aborted", "aborted");
					const key = await resolveApiKey();
					if (!key) return errorResult(model, "CommandCode anahtarı yok (pi auth / CMD_API_KEY)", "error");

					const questions = context?.questions ?? {};
					const state = context?.state ?? {};
					const qids = Object.keys(questions);
					if (qids.length === 0) {
						return { api: model?.api ?? API, provider: PROVIDER, model: model?.id ?? MODEL_ID, answers: {}, stopReason: "stop", timestamp: Date.now() };
					}

					const body = { model: config.model, state, questions: toNativeQuestions(questions) };
					try {
						const doFetch = globalThis.fetch;
						const res = await doFetch(ENDPOINT, {
							method: "POST",
							headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "User-Agent": "openai-node/4.0.0" },
							body: JSON.stringify(body),
							signal: options?.signal,
						});
						if (!res.ok) {
							const text = await res.text().catch(() => "");
							return errorResult(model, `CommandCode HTTP ${res.status}: ${text.slice(0, 200)}`, "error");
						}
						const data: any = await res.json();
						const answers = normalizeNativeAnswers(questions, data?.answers);
						if (Object.keys(answers).length === 0) return errorResult(model, "cevap çözümlenemedi", "error");
						debug(`classify ok: ${Object.keys(answers).length}/${qids.length} soru`);
						return { api: model?.api ?? API, provider: PROVIDER, model: model?.id ?? MODEL_ID, answers, stopReason: "stop", timestamp: Date.now() };
					} catch (err) {
						if (options?.signal?.aborted) return errorResult(model, "aborted", "aborted");
						return errorResult(model, `CommandCode isteği başarısız: ${String(err).slice(0, 200)}`, "error");
					}
				},
			},
		},
	});

	pi.registerCommand("jev-test", {
		description: "CommandCode destekli Jev (typesafe/jev) classifier'ını dene",
		handler: async (args, ctx: ExtensionContext) => {
			const model = ctx.modelRegistry.findOfType("classifier", PROVIDER, MODEL_ID);
			if (!model) {
				ctx.ui.notify("Jev classifier bulunamadı", "error");
				return;
			}
			const subject = args.trim() || "Anomali tespiti için PatchCore ve EfficientAD kullanıyoruz.";
			const result = await ctx.modelRegistry.classify(
				model,
				{
					state: { text: subject, candidates: [{ id: "a", title: "CV stajı", statement: "Görüntü işleme anomali tespiti" }] },
					questions: {
						relevance: {
							type: "score",
							instructions: "candidates[0] `text` ile ne kadar ilgili?",
							criteria: ["İlgisiz", "Arka plan", "Doğrudan ilgili"],
						},
						approval: {
							type: "bool",
							instructions: "Metin bir onay ifade ediyor mu?",
							criteria: { true: "Onay", false: "Onay değil" },
						},
					},
				},
				{},
			);
			if (result.stopReason !== "stop") {
				ctx.ui.notify(`Jev hata: ${result.errorMessage ?? result.stopReason}`, "error");
				return;
			}
			ctx.ui.notify(`Jev cevapları: ${JSON.stringify(result.answers)}`, "info");
		},
	});
}
