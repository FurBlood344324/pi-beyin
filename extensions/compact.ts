/**
 * beyin-compact — a context budget for pi, with Jev deciding *when* to compact.
 *
 * pi's built-in auto-compaction only says "the window is nearly full": on a 1M-token
 * model it fires around 984k. That is far too late to be a useful working budget, so
 * this extension adds a **soft budget** (240k by default) well below it:
 *
 *   ┌ soft budget (this file) ─ tokens >= min(tokens, percent × window) ─ Jev decides
 *   ├ hard backstop ─────────── pi's own reserveTokens (untouched, ~984k) ─ mechanical
 *   └ overflow recovery ─────── pi's built-in overflow/length retry ──────── mechanical
 *
 * Jev is never asked "how should the summary read"; it only answers a *timing*
 * question. The summary itself is pi's own compaction (cut points, iterative summary
 * chain, cumulative file tracking, cache-safe requests, overflow retry) — we do not
 * reimplement it, we only decide when it runs and give it vault-flavoured focus via
 * `customInstructions`. See docs/beyin-compact.md for the reasoning.
 *
 * Decision table (an over-threshold turn always ends in one of these):
 *
 *   tokens < threshold .................. nothing (Jev is not even asked)
 *   jev "gate" + jev says now ........... compact
 *   jev "gate" + jev says not-now ....... defer, at most deferMax times
 *   jev "off" .......................... compact, no question
 *   jev unavailable / timeout / error ... compact (fail-safe: the threshold was crossed)
 *   threshold + deferMax exhausted ...... compact
 *   /compact-now ....................... compact, no question
 *
 * Vault integration (source ≠ view): after any compaction — ours, pi's threshold, an
 * overflow recovery or the user's `/compact` — the summary is spooled to
 * `<vault>/.pi/compaction/<ts>-<sid>.md`. That directory is a dot-directory, which the
 * vault indexer skips, so a model-written summary can never come back as verified
 * knowledge. Promotion to a real note stays a user decision.
 *
 * Configuration: `{ "compact": { ... } }` in pi-hook.json (same file the context
 * extension already reads), plus environment overrides. Defaults are complete: with no
 * configuration at all the extension is ON with a 240k budget and Jev gating, unless
 * Jev is unavailable.
 *
 *   compact.enabled            true        master switch
 *   compact.tokens             240000      absolute ceiling
 *   compact.percent            0.6         window share; effective = min(tokens, percent*window)
 *   compact.jev                "gate"      "gate" | "off"
 *   compact.deferMax           2           how many turns Jev may postpone
 *   compact.jevTimeoutMs       2500        after this, decide without Jev (compact)
 *   compact.instructions       (built-in)  extra focus for pi's summarizer
 *   compact.disabledProjects   []          path prefixes where this extension stays quiet
 *   compact.spool              true        write summaries under <vault>/.pi/compaction
 *   compact.log                (default)   ~/.config/beyin/compact.log (JSONL, decisions)
 *
 * Env overrides: BEYIN_COMPACT=0, BEYIN_COMPACT_TOKENS, BEYIN_COMPACT_PERCENT,
 * BEYIN_COMPACT_JEV, BEYIN_COMPACT_DEFER_MAX, BEYIN_COMPACT_JEV_TIMEOUT_MS,
 * BEYIN_COMPACT_INSTRUCTIONS, BEYIN_COMPACT_SPOOL, BEYIN_COMPACT_LOG,
 * BEYIN_VAULT, BEYIN_HOOK_CONFIG, BEYIN_DEBUG, BEYIN_LANG.
 *
 * Fail-open: any error in this file leaves the turn alone and falls through to pi's own
 * compaction. The only fail-*safe* asymmetry is the decision itself: when the budget is
 * crossed and Jev cannot answer, we compact.
 */

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HOME = process.env.HOME || homedir();
const VAULT = process.env.BEYIN_VAULT || path.join(HOME, "projects", "beyin");
const HOOK_CONFIG_FILE = process.env.BEYIN_HOOK_CONFIG || path.join(HOME, ".config", "beyin", "pi-hook.json");
const LOG_FILE = process.env.BEYIN_COMPACT_LOG || path.join(HOME, ".config", "beyin", "compact.log");
const DEBUG = process.env.BEYIN_DEBUG === "1";

/** Read at call time, not at import time: a test (or a reloaded session) can flip it. */
function envDisabled(): boolean {
	return process.env.BEYIN_COMPACT === "0" || process.env.BEYIN_DISABLE === "1";
}
/** Model-facing fixed texts: "tr" (default) or "en" via BEYIN_LANG. */
const LANG = /^en/i.test(process.env.BEYIN_LANG || "") ? "en" : "tr";
const L = (tr: string, en: string): string => (LANG === "en" ? en : tr);

/** Jev classifier registered by extensions/jev.ts (findOfType ids must match). */
const JEV_PROVIDER = "beyin-jev";
const JEV_MODEL_ID = "jev-commandcode";

const DEFAULT_INSTRUCTIONS_TR =
	"Bu bir kod/araştırma oturumu. Devam eden işi, verilen kararları ve gerekçelerini, " +
	"bekleyen onayları ve açık soruları koru. Doğrulanmış olguları (komut çıktısıyla kanıtlanmış) " +
	"varsayımlardan ayır. Bir 'Sources' bölümü ekle: yük taşıyan dosya yolları ve vault not yolları.";
const DEFAULT_INSTRUCTIONS_EN =
	"This is a coding/research session. Preserve the work in flight, the decisions taken and their " +
	"rationale, pending approvals and open questions. Separate verified facts (proven by command " +
	"output) from assumptions. Add a 'Sources' section: the load-bearing file paths and vault note paths.";

function debug(msg: string): void {
	if (DEBUG) process.stderr.write(`[beyin-compact] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

interface CompactConfig {
	enabled: boolean;
	tokens: number;
	percent: number;
	jev: "gate" | "off";
	deferMax: number;
	jevTimeoutMs: number;
	instructions: string;
	disabledProjects: string[];
	spool: boolean;
}

function num(value: unknown, fallback: number, min: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < min) return fallback;
	return n;
}

/** Load `<hook>/compact`; unknown or invalid fields fall back one by one (fail-safe). */
function loadConfig(): CompactConfig {
	const defaults: CompactConfig = {
		enabled: true,
		tokens: 240_000,
		percent: 0.6,
		jev: "gate",
		deferMax: 2,
		jevTimeoutMs: 2500,
		instructions: LANG === "en" ? DEFAULT_INSTRUCTIONS_EN : DEFAULT_INSTRUCTIONS_TR,
		disabledProjects: [],
		spool: true,
	};
	let fromFile: Record<string, unknown> = {};
	try {
		if (fs.existsSync(HOOK_CONFIG_FILE)) {
			const all = JSON.parse(fs.readFileSync(HOOK_CONFIG_FILE, "utf8")) as Record<string, unknown>;
			const block = all?.compact;
			if (block && typeof block === "object" && !Array.isArray(block)) fromFile = block as Record<string, unknown>;
		}
	} catch (err) {
		debug(`pi-hook config okunamadı: ${String(err)}`);
	}
	const env = process.env;
	const offset = fromFile.disabledProjects;
	return {
		enabled: typeof fromFile.enabled === "boolean" ? fromFile.enabled : defaults.enabled,
		tokens: num(env.BEYIN_COMPACT_TOKENS ?? fromFile.tokens, defaults.tokens, 1),
		percent: num(env.BEYIN_COMPACT_PERCENT ?? fromFile.percent, defaults.percent, 0.05),
		jev: (env.BEYIN_COMPACT_JEV ?? fromFile.jev) === "off" ? "off" : "gate",
		deferMax: num(env.BEYIN_COMPACT_DEFER_MAX ?? fromFile.deferMax, defaults.deferMax, 0),
		jevTimeoutMs: num(env.BEYIN_COMPACT_JEV_TIMEOUT_MS ?? fromFile.jevTimeoutMs, defaults.jevTimeoutMs, 100),
		instructions:
			env.BEYIN_COMPACT_INSTRUCTIONS ||
			(typeof fromFile.instructions === "string" ? fromFile.instructions : defaults.instructions),
		disabledProjects: Array.isArray(offset)
			? offset.filter((p): p is string => typeof p === "string" && p.length > 0)
			: defaults.disabledProjects,
		spool:
			env.BEYIN_COMPACT_SPOOL === "0"
				? false
				: env.BEYIN_COMPACT_SPOOL === "1"
					? true
					: typeof fromFile.spool === "boolean"
						? fromFile.spool
						: defaults.spool,
	};
}

function inside(prefix: string, cwd: string): boolean {
	try {
		const rel = path.relative(prefix, cwd);
		return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
	} catch {
		return false;
	}
}

/** Effective budget for this session: the smaller of the absolute and the window share. */
function thresholdFor(config: CompactConfig, contextWindow: number): number {
	const share = Math.floor(contextWindow * config.percent);
	if (!Number.isFinite(share) || share <= 0) return config.tokens;
	return Math.min(config.tokens, share);
}

// ---------------------------------------------------------------------------
// observability: JSONL decision log
// ---------------------------------------------------------------------------

function logLine(entry: Record<string, unknown>): void {
	try {
		fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
		fs.appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
	} catch (err) {
		debug(`log yazılamadı: ${String(err)}`);
	}
}

/** Last decision, surfaced by /compact-status without re-reading the log. */
let lastDecision: Record<string, unknown> | undefined;

// ---------------------------------------------------------------------------
// digest: what Jev gets to see
// ---------------------------------------------------------------------------

interface Digest {
	text: string;
	toolWrites: number;
	toolReads: number;
	endsWithTool: boolean;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
			const t = (block as { text?: unknown }).text;
			if (typeof t === "string") parts.push(t);
		}
	}
	return parts.join("\n");
}

/** Deterministic, cheap summary of the session state. No model call, no vault read. */
function buildDigest(ctx: ExtensionContext, tokens: number, threshold: number, contextWindow: number): Digest {
	const branch: any[] = (() => {
		try {
			return (ctx as any).sessionManager?.getBranch?.() ?? [];
		} catch {
			return [];
		}
	})();

	let lastCompactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i]?.type === "compaction") {
			lastCompactionIndex = i;
			break;
		}
	}
	const since: any[] = lastCompactionIndex >= 0 ? branch.slice(lastCompactionIndex + 1) : branch;

	const userTexts: string[] = [];
	for (const entry of since) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role !== "user") continue;
		const t = textOf(message.content).replace(/\s+/g, " ").trim();
		if (t) userTexts.push(t.length > 220 ? `${t.slice(0, 220)}…` : t);
	}
	const recentUsers = userTexts.slice(-3);

	// Everything after the newest user message = the work currently in flight.
	let lastUserAt = -1;
	for (let i = since.length - 1; i >= 0; i--) {
		const message = since[i]?.message;
		if (since[i]?.type === "message" && message?.role === "user") {
			lastUserAt = i;
			break;
		}
	}
	const inFlight: any[] = lastUserAt >= 0 ? since.slice(lastUserAt + 1) : since;

	const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob", "web_search", "web_fetch", "context", "codemode"]);
	let toolReads = 0;
	let toolWrites = 0;
	let assistantMessages = 0;
	let receiptWritten = false;
	const recentTools: string[] = [];

	for (const entry of inFlight) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role === "assistant") {
			assistantMessages++;
			for (const block of Array.isArray(message.content) ? message.content : []) {
				if (block?.type !== "toolCall") continue;
				const name = String(block.name ?? "?");
				recentTools.push(name);
				if (READ_TOOLS.has(name)) toolReads++;
				else toolWrites++;
				const args = JSON.stringify(block.arguments ?? {});
				if (/beyin\.py\s+(?:receipt|note-create)/.test(args) || /beyin\.py\s+(?:receipt|note-create)/.test(String(block.arguments?.command ?? ""))) {
					receiptWritten = true;
				}
			}
		}
	}

	const lastEntry = since.length > 0 ? since[since.length - 1] : undefined;
	const lastRole = lastEntry?.type === "message" ? String(lastEntry.message?.role ?? "?") : String(lastEntry?.type ?? "?");
	const endsWithTool = lastRole === "toolResult";

	const pct = contextWindow > 0 ? ((tokens / contextWindow) * 100).toFixed(1) : "?";
	const sessionName = (() => {
		try {
			return String((ctx as any).sessionManager?.getSessionName?.() ?? "");
		} catch {
			return "";
		}
	})();
	const sid = (() => {
		try {
			return String((ctx as any).sessionManager?.getSessionId?.() ?? "");
		} catch {
			return "";
		}
	})();
	const compactions = branch.filter((e) => e?.type === "compaction").length;

	const lines: string[] = [
		`Proje: ${path.basename(ctx.cwd)} (${ctx.cwd})`,
		`Oturum: ${sessionName || `${sid.slice(0, 8) || "?"}`}`,
		`Bağlam: ${Math.round(tokens / 1000)}k / ${Math.round(contextWindow / 1000)}k token (%${pct}) · bütçe ${Math.round(threshold / 1000)}k`,
		`Bu oturumdaki önceki sıkıştırma sayısı: ${compactions}`,
	];
	if (recentUsers.length > 0) {
		lines.push("Son kullanıcı istekleri (eskiden yeniye):");
		recentUsers.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));
	} else {
		lines.push("Kullanıcı isteği görünmüyor (önceki sıkıştırma sonrası).");
	}
	lines.push(
		`Son kullanıcı isteğinden bu yana: ${assistantMessages} asistan mesajı, ${toolReads} okuma / ${toolWrites} yazma araç çağrısı`,
	);
	if (recentTools.length > 0) lines.push(`Son araçlar: ${recentTools.slice(-6).join(", ")}`);
	lines.push(
		endsWithTool
			? `Son adım: araç sonucu (${String((lastEntry as any)?.message?.toolName ?? "?")}) — akış sürüyor`
			: `Son adım: ${lastRole} — tur kapanmış görünüyor`,
	);
	lines.push(`Vault'a kayıt (beyin.py receipt/note-create): ${receiptWritten ? "var" : "yok"}`);

	return { text: lines.join("\n"), toolReads, toolWrites, endsWithTool };
}

// ---------------------------------------------------------------------------
// Jev: a timing decision, not a summary
// ---------------------------------------------------------------------------

interface Verdict {
	source: "jev" | "unavailable" | "off";
	compactNow?: number;
	moment?: string;
	stale?: number;
	error?: string;
}

function pendingQuestions(deferCount: number, config: CompactConfig): Record<string, any> {
	return {
		compact_now: {
			type: "bool",
			instructions: L(
				"Şu anda bu oturumun bağlamını özetleyip kısaltmak güvenli mi? (iş yarım kalmışsa ve kaybolacaksa hayır)",
				"Is it safe to summarize and shrink this session's context right now? (no if work is half done and would be lost)",
			),
		},
		moment: {
			type: "choice",
			instructions: L("Şu an hangi ana daha yakın?", "Which moment is this closer to?"),
			criteria: {
				boundary: L("İş bitmiş, doğal sınır", "Work finished, natural boundary"),
				mid_task: L("Yarım kalan işin ortası", "Middle of unfinished work"),
				idle: L("Beklemede, iş yok", "Waiting, no work in flight"),
			},
		},
		stale_share: {
			type: "score",
			instructions: L(
				"Bağlamın ne kadarı artık gerekli değil (okunmuş dosyalar, bitmiş tartışma)?",
				"How much of the context is no longer needed (files already read, settled discussion)?",
			),
			criteria: [
				L("Neredeyse tamamı hâlâ gerekli", "Almost all still needed"),
				L("Yarısı eski", "Half is stale"),
				L("Çoğu artık gereksiz", "Most is no longer needed"),
			],
		},
		deferred_note: {
			type: "bool",
			instructions: L(
				`Bu, eşiğin üstündeki ${deferCount + 1}. tur; erteleme bütçesi ${config.deferMax}. Buna rağmen ertelemek gerçekten gerekli mi?`,
				`This is turn ${deferCount + 1} over budget; the defer budget is ${config.deferMax}. Is postponing still really worth it?`,
			),
		},
	};
}

/** Ask Jev; any failure means "unavailable" so the caller can fall back to compacting. */
async function askJev(ctx: ExtensionContext, digest: Digest, deferCount: number, config: CompactConfig): Promise<Verdict> {
	const registry = (ctx as any).modelRegistry;
	if (!registry?.classify || !registry?.findOfType) return { source: "unavailable", error: "registry" };
	let model: any;
	try {
		model = registry.findOfType("classifier", JEV_PROVIDER, JEV_MODEL_ID);
	} catch (err) {
		return { source: "unavailable", error: String(err).slice(0, 120) };
	}
	if (!model) return { source: "unavailable", error: "classifier-yok" };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.jevTimeoutMs);
	try {
		const result = await registry.classify(
			model,
			{
				state: {
					text: digest.text,
					candidates: [{ id: "compaction", title: "Şimdi sıkıştır", statement: "Bağlamı şimdi özetle" }],
				},
				questions: pendingQuestions(deferCount, config),
			},
			{ signal: controller.signal, maxTokens: 64 },
		);
		if (result?.stopReason !== "stop") {
			return { source: "unavailable", error: String(result?.stopReason ?? "stop-yok") };
		}
		const answers = result.answers ?? {};
		return {
			source: "jev",
			compactNow: answers.compact_now?.probability,
			moment: answers.moment?.choice,
			stale: answers.stale_share?.score,
		};
	} catch (err) {
		return { source: "unavailable", error: String(err).slice(0, 120) };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The decision itself, kept in one place so it can be read without following the flow.
 *
 * Default is "go": we are already above the budget, so only an explicit Jev verdict
 * that we are mid-task *and* unsure it is safe may postpone — and never more than
 * deferMax times. `stale_share` is recorded for later tuning, deliberately not acted
 * on: inventing a staleness rule before seeing the data would be a guess dressed up as
 * a policy.
 */
function decide(verdict: Verdict, deferCount: number, config: CompactConfig): { action: "compact" | "defer"; why: string } {
	if (verdict.source !== "jev") return { action: "compact", why: `jev-${verdict.source}` };
	const safeNow = typeof verdict.compactNow === "number" ? verdict.compactNow >= 0.5 : undefined;
	if (safeNow === false && verdict.moment === "mid_task") {
		if (deferCount >= config.deferMax) return { action: "compact", why: "erteleme-bütçesi-doldu" };
		return { action: "defer", why: "jev-yarım-iş" };
	}
	if (safeNow === undefined) return { action: "compact", why: "jev-cevapsız" };
	return { action: "compact", why: safeNow ? "jev-uygun" : "jev-sınır" };
}

// ---------------------------------------------------------------------------
// spool: the summary as a derived artifact, never as knowledge
// ---------------------------------------------------------------------------

function spoolPath(sessionId: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	return path.join(VAULT, ".pi", "compaction", `${stamp}-${(sessionId || "unknown").slice(0, 8)}.md`);
}

function spool(sessionId: string, project: string, reason: string, tokensBefore: number | null, model: string, summary: string): string | undefined {
	try {
		const file = spoolPath(sessionId);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const front = [
			"---",
			"kind: compaction-spool",
			"derived: true",
			`session: ${sessionId || "unknown"}`,
			`project: ${project}`,
			`reason: ${reason}`,
			`tokens_before: ${tokensBefore ?? "unknown"}`,
			`model: ${model || "unknown"}`,
			`created: ${new Date().toISOString()}`,
			"---",
			"",
		].join("\n");
		const body = [
			"<!-- Türev artefakt: pi bağlam sıkıştırmasının özeti. Doğrulanmış bilgi değildir,",
			"     vault indeksine girmez (nokta-dizin). Notaya terfi ettirmek kullanıcı kararıdır. -->",
			"",
			summary.trim(),
			"",
		].join("\n");
		fs.writeFileSync(file, `${front}${body}`, "utf8");
		return file;
	} catch (err) {
		debug(`spool yazılamadı: ${String(err)}`);
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// extension
// ---------------------------------------------------------------------------

export default function beyinCompact(pi: ExtensionAPI) {
	const config = loadConfig();
	/** Deferrals granted in the current over-budget stretch; reset once we are back under. */
	let deferCount = 0;
	/** A Jev decision or a compaction is in flight; never start a second one. */
	let busy = false;
	let lastCompactAt = 0;

	function active(cwd: string): boolean {
		if (envDisabled() || !config.enabled) return false;
		for (const project of config.disabledProjects) if (inside(project, cwd)) return false;
		return true;
	}

	async function tick(ctx: ExtensionContext, trigger: string): Promise<void> {
		if (busy || !active(ctx.cwd)) return;
		const usage = ctx.getContextUsage?.();
		if (!usage || typeof usage.tokens !== "number") return;
		const threshold = thresholdFor(config, usage.contextWindow);
		const tokens = usage.tokens;

		if (tokens < threshold) {
			if (deferCount > 0) {
				debug(`bütçe altına dönüldü (${tokens} < ${threshold}); erteleme sayacı sıfırlandı`);
				deferCount = 0;
			}
			return;
		}
		// Only a genuinely idle session may compact: `ctx.compact()` aborts the current run.
		if (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
			debug(`${trigger}: eşik aşıldı ama oturum boşta değil, atlandı`);
			return;
		}
		if (Date.now() - lastCompactAt < 5000) return;

		busy = true;
		/** Set when pi owns the in-flight compaction; its callbacks then release `busy`. */
		let handedToPi = false;
		try {
			const digest = buildDigest(ctx, tokens, threshold, usage.contextWindow);
			const verdict: Verdict = config.jev === "off" ? { source: "off" } : await askJev(ctx, digest, deferCount, config);
			const { action, why } = decide(verdict, deferCount, config);

			lastDecision = {
				at: new Date().toISOString(),
				trigger,
				tokens,
				contextWindow: usage.contextWindow,
				threshold,
				verdict,
				action,
				why,
				deferCount,
			};
			logLine({
				event: "decision",
				...lastDecision,
				digest: digest.text,
				deferMax: config.deferMax,
				jevMode: config.jev,
			});

			if (action === "defer") {
				deferCount++;
				if (ctx.hasUI) {
					const limit = config.deferMax > 0 ? ` (${deferCount}/${config.deferMax})` : "";
					ctx.ui.notify(
						L(
							`bağlam ${Math.round(tokens / 1000)}k · sıkıştırma ertelendi${limit}`,
							`context ${Math.round(tokens / 1000)}k · compaction postponed${limit}`,
						),
						"info",
					);
				}
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.notify(
					L(
						`bağlam ${Math.round(tokens / 1000)}k → sıkıştırılıyor (${why})`,
						`context ${Math.round(tokens / 1000)}k → compacting (${why})`,
					),
					"info",
				);
			}
			lastCompactAt = Date.now();
			handedToPi = true;
			const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
			ctx.compact({
				customInstructions: config.instructions,
				onComplete: (result: any) => {
					busy = false;
					deferCount = 0;
					logLine({
						event: "compacted",
						inFlight: Math.round((Date.now() - lastCompactAt) / 1000),
						tokensBefore: result?.tokensBefore ?? tokens,
						estimatedTokensAfter: result?.estimatedTokensAfter ?? null,
						model,
						why,
					});
					if (ctx.hasUI) {
						const after = result?.estimatedTokensAfter;
						ctx.ui.notify(
							L(
								`sıkıştırıldı${typeof after === "number" ? `: ~${Math.round(after / 1000)}k token` : ""}${config.spool ? " · özet vault'a kaydedildi" : ""}`,
								`compacted${typeof after === "number" ? `: ~${Math.round(after / 1000)}k tokens` : ""}${config.spool ? " · summary spooled to the vault" : ""}`,
							),
							"info",
						);
					}
				},
				onError: (err: Error) => {
					busy = false;
					logLine({ event: "failed", error: String(err?.message ?? err).slice(0, 300), why });
					if (ctx.hasUI) {
						ctx.ui.notify(
							L(`sıkıştırma başarısız: ${String(err?.message ?? err).slice(0, 120)}`, `compaction failed: ${String(err?.message ?? err).slice(0, 120)}`),
							"error",
						);
					}
				},
			});
		} catch (err) {
			busy = false;
			debug(`tick hatası: ${String(err)}`);
		} finally {
			// Nothing was handed to pi (defer, skip, throw): release the guard here. When a
			// compaction started, onComplete/onError own `busy` — a compaction in flight must
			// never be joined by a second one.
			if (!handedToPi) busy = false;
		}
	}

	pi.on("session_start", () => {
		deferCount = 0;
		busy = false;
	});

	// The only safe moment to start a compaction from an extension: pi has fully settled,
	// so an abort is a no-op and no tool batch is mid-flight.
	pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
		await tick(ctx, "settled");
	});

	// Any compaction — ours, pi's threshold, overflow recovery, the user's /compact —
	// lands here; one place writes the spool (single ownership).
	pi.on("session_compact", (event, ctx: ExtensionContext) => {
		const payload = event as any;
		const entry = payload?.compactionEntry;
		const sid = (() => {
			try {
				return String((ctx as any).sessionManager?.getSessionId?.() ?? "");
			} catch {
				return "";
			}
		})();
		const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		const file =
			entry && config.spool
				? spool(sid, ctx.cwd, String(payload?.reason ?? "unknown"), entry.tokensBefore ?? null, model, entry.summary ?? "")
				: undefined;
		logLine({
			event: "spooled",
			file: file ?? null,
			reason: payload?.reason ?? null,
			fromExtension: payload?.fromExtension === true,
			tokensBefore: entry?.tokensBefore ?? null,
			summaryChars: String(entry?.summary ?? "").length,
		});
		if (file && ctx.hasUI) {
			ctx.ui.notify(
				L(`compaction özeti vault'a yazıldı: ${path.relative(VAULT, file)}`, `compaction summary spooled: ${path.relative(VAULT, file)}`),
				"info",
			);
		}
	});

	pi.on("session_compact_failed", (_event) => {
		const event = _event as any;
		logLine({
			event: "compact_failed",
			reason: event?.reason ?? null,
			error: String(event?.errorMessage ?? "").slice(0, 300),
			aborted: event?.aborted === true,
			willRetry: event?.willRetry === true,
		});
	});

	pi.registerCommand("compact-status", {
		description: L("Bağlam bütçesini, Jev kararını ve spool dizinini göster", "Show the context budget, the last Jev decision and the spool directory"),
		handler: async (_args, ctx: ExtensionContext) => {
			const usage = ctx.getContextUsage?.();
			const threshold = usage ? thresholdFor(config, usage.contextWindow) : thresholdFor(config, 0) || config.tokens;
			const state = envDisabled() || !config.enabled ? L("kapalı", "off") : config.jev === "off" ? "jev=off" : "jev=gate";
			const where = active(ctx.cwd) ? L("bu projede açık", "active here") : L("bu projede kapalı", "inactive here");
			const lines = [
				`beyin-compact · ${state} · ${where}`,
				usage && typeof usage.tokens === "number"
					? `bağlam: ${usage.tokens} / ${usage.contextWindow} (%${usage.percent?.toFixed?.(1) ?? "?"}) · bütçe: ${threshold}`
					: L("bağlam: bilinmiyor (sıkıştırma yeni bitti)", "context: unknown (a compaction just finished)"),
				`erteleme: ${deferCount}/${config.deferMax} · spool: ${config.spool ? path.join(VAULT, ".pi", "compaction") : "kapalı"} · log: ${LOG_FILE}`,
				lastDecision
					? `son karar: ${String(lastDecision.action)} (${String(lastDecision.why)}) @ ${String(lastDecision.at)}`
					: L("son karar: bu oturumda henüz yok", "last decision: none yet in this session"),
			];
			if (lastDecision?.verdict && typeof lastDecision.verdict === "object") {
				const v = lastDecision.verdict as Verdict;
				lines.push(
					`jev: source=${v.source} compact_now=${v.compactNow ?? "-"} moment=${v.moment ?? "-"} stale=${v.stale ?? "-"}${v.error ? ` error=${v.error}` : ""}`,
				);
			}
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("compact-now", {
		description: L("Jev'e sormadan hemen sıkıştır", "Compact now without asking Jev"),
		handler: async (_args, ctx: ExtensionContext) => {
			if (busy) {
				ctx.ui.notify(L("zaten bir sıkıştırma sürüyor", "a compaction is already running"), "warning");
				return;
			}
			const usage = ctx.getContextUsage?.();
			busy = true;
			lastCompactAt = Date.now();
			logLine({ event: "manual", tokens: usage?.tokens ?? null, manual: true });
			ctx.compact({
				customInstructions: config.instructions,
				onComplete: (result: any) => {
					busy = false;
					deferCount = 0;
					logLine({ event: "compacted", manual: true, tokensBefore: result?.tokensBefore ?? null, estimatedTokensAfter: result?.estimatedTokensAfter ?? null });
				},
				onError: (err: Error) => {
					busy = false;
					logLine({ event: "failed", manual: true, error: String(err?.message ?? err).slice(0, 300) });
				},
			});
		},
	});
}
