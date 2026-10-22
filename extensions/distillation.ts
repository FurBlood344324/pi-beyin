/**
 * Beyin distillation — a knowledge-distillation SUGGESTION at turn/session end.
 *
 * Why: in beyin's bare form the concept/distillation work is done by the active
 * agent, not a background model. But the
 * "was the lesson distilled" step could be skipped silently. If a turn wrote a record
 * to the second brain without distilling under `knowledge/`, this extension injects a
 * short "offer distillation candidates" instruction at the end of the turn.
 *
 * Important: it does NOT write automatically. It only tells the agent to "offer
 * candidates to the user and ask for approval". The actual knowledge note is written
 * by the agent after user approval. That keeps the "suggestion -> user approval ->
 * write" principle intact; the vault does not become an inference factory.
 *
 * When it triggers (all together):
 *   - the turn ended "completed" and is continuable (canContinue)
 *   - the turn wrote a record (beyin.py receipt/note-create/task-create), wrote to the vault, **or
 *     called the `beyin_jev_*` advisor** (asking the advisor and skipping distillation is the typical leak)
 *   - nothing was WRITTEN under `knowledge/` during the turn
 *   - the cooldown elapsed (default 30 min) — so it does not nag every turn
 *
 * Project exception: setting `pi-hook.json` -> `injectionOnly.<project>.distillation: true` turns the
 * distillation suggestion on in that project even with reminders off (keeps distillation from
 * disappearing entirely in self-tracking projects such as work).
 *
 * Configuration: ~/.config/beyin/distillation.json (legacy: damitma.json)
 *   { "enabled": true, "cooldownMinutes": 30, "maxCandidates": 3 }
 * Env: BEYIN_DISTILLATION="0" (legacy BEYIN_DAMITMA) -> off; BEYIN_DISABLE="1" -> fully silent;
 *      BEYIN_DEBUG="1" -> stderr diagnostics; BEYIN_VAULT -> vault path.
 *
 * Lives OUTSIDE the vault; beyin updates do not touch it.
 */

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HOME = process.env.HOME || homedir();
const VAULT = process.env.BEYIN_VAULT || path.join(HOME, "projects", "beyin");
/**
 * Config file: `distillation.json` is the current name, `damitma.json` the legacy one.
 * New name wins when both exist; `BEYIN_DISTILLATION_CONFIG` then `BEYIN_DAMITMA_CONFIG` override.
 */
function defaultConfigFile(): string {
	const dir = path.join(HOME, ".config", "beyin");
	const current = path.join(dir, "distillation.json");
	const legacy = path.join(dir, "damitma.json");
	try {
		if (fs.existsSync(current) || !fs.existsSync(legacy)) return current;
	} catch {
		/* fall through to legacy */
	}
	return legacy;
}

const CONFIG_FILE =
	process.env.BEYIN_DISTILLATION_CONFIG || process.env.BEYIN_DAMITMA_CONFIG || defaultConfigFile();
const HOOK_CONFIG_FILE = process.env.BEYIN_HOOK_CONFIG || path.join(HOME, ".config", "beyin", "pi-hook.json");
const DEFAULT_EXCLUDES: string[] = [];
const DISABLED =
	process.env.BEYIN_DISTILLATION === "0" ||
	process.env.BEYIN_DAMITMA === "0" ||
	process.env.BEYIN_DISABLE === "1";
const DEBUG = process.env.BEYIN_DEBUG === "1";
/** Model-facing fixed texts: "tr" (default) or "en" via BEYIN_LANG. */
const LANG = /^en/i.test(process.env.BEYIN_LANG || "") ? "en" : "tr";

const RECEIPT_RE = /(?:^|\s)beyin\.py\s+(?:receipt|note-create|task-create|task-update)\b/;
const KNOWLEDGE_RE = /(^|[\\/])knowledge[\\/]/;

function debug(msg: string): void {
	if (DEBUG) process.stderr.write(`[beyin-distillation] ${msg}\n`);
}

interface DamitmaConfig {
	enabled: boolean;
	cooldownMinutes: number;
	maxCandidates: number;
}

function loadConfig(): DamitmaConfig {
	const defaults: DamitmaConfig = { enabled: true, cooldownMinutes: 30, maxCandidates: 3 };
	try {
		if (!fs.existsSync(CONFIG_FILE)) return defaults;
		const c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
		return {
			enabled: c.enabled !== false,
			cooldownMinutes: typeof c.cooldownMinutes === "number" && c.cooldownMinutes >= 0 ? c.cooldownMinutes : defaults.cooldownMinutes,
			maxCandidates: typeof c.maxCandidates === "number" && c.maxCandidates > 0 ? Math.min(5, Math.round(c.maxCandidates)) : defaults.maxCandidates,
		};
	} catch (err) {
		debug(`config okunamadı: ${String(err)}`);
		return defaults;
	}
}

/** Projects with their own mature memory system (e.g. work): the distillation suggestion stays quiet too. */
function excludedProjects(): string[] {
	try {
		if (!fs.existsSync(HOOK_CONFIG_FILE)) return DEFAULT_EXCLUDES;
		const c = JSON.parse(fs.readFileSync(HOOK_CONFIG_FILE, "utf8"));
		if (Array.isArray(c.excludeProjects) && c.excludeProjects.every((p: unknown) => typeof p === "string")) {
			return c.excludeProjects;
		}
	} catch (err) {
		debug(`pi-hook config okunamadı: ${String(err)}`);
	}
	return DEFAULT_EXCLUDES;
}

function isExcluded(cwd: string): boolean {
	for (const project of excludedProjects()) {
		if (!project) continue;
		try {
			const rel = path.relative(project, cwd);
			if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return true;
		} catch {
			/* ignore */
		}
	}
	// Stay quiet in injectionOnly projects too (a second mechanism would duplicate the project's own tracking system).
	try {
		const c = JSON.parse(fs.readFileSync(HOOK_CONFIG_FILE, "utf8")) as Record<string, unknown>;
		if (c.injectionOnly && typeof c.injectionOnly === "object" && !Array.isArray(c.injectionOnly)) {
			for (const project of Object.keys(c.injectionOnly as Record<string, unknown>)) {
				if (typeof project !== "string" || !project) continue;
				const rel = path.relative(project, cwd);
				if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) continue;
				const opts = (c.injectionOnly as Record<string, unknown>)[project];
				// Per-project exception: distillation may stay on even with reminders off.
				// `distillation` is the current key; `damitma` is accepted for older configs.
				const o = (opts ?? {}) as Record<string, unknown>;
				if (o.distillation === true || o.damitma === true) continue;
				return true;
			}
		}
	} catch {
		/* no config -> nothing to do */
	}
	return false;
}

function insideVault(p: string): boolean {
	try {
		const rel = path.relative(VAULT, p);
		return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
	} catch {
		return false;
	}
}

function instruction(maxCandidates: number): string {
	if (LANG === "en") {
		return [
			"## Second brain — distillation offer",
			"This turn wrote to the second brain but nothing was distilled under `knowledge/`.",
			"Now give the user a SHORT distillation offer (a short visible list):",
			`- At most ${maxCandidates} candidates. One line each: **title** — one sentence — source (file/receipt path).`,
			"- Offer only reusable lessons/decisions/concepts/methods; never invent candidates to fill a quota, never offer transient detail.",
			'- If there is no durable lesson, skip the offer and say "nothing durable to distill" in one sentence.',
			"- Write nothing under `knowledge/` before the user approves. After approval, write it with `beyin.py note-create` and add it to the receipt refs.",
			"- If improving an existing knowledge note is enough, say so; do not open a new file.",
		].join("\n");
	}
	return [
		"## İkinci beyin — damıtma önerisi",
		"Bu turda ikinci beyne kayıt düşüldü ama kalıcı bilgi `knowledge/` altına damıtılmadı.",
		"Şimdi kullanıcıya KISA bir damıtma önerisi sun (görünür kısa bir liste):",
		`- En fazla ${maxCandidates} aday. Her aday tek satır: **başlık** — tek cümlelik içerik — kaynak (dosya/receipt yolu).`,
		"- Yalnızca tekrar kullanılabilir öğrenim/karar/kavram/yöntem adaylarını öner; kota doldurmak için uydurma, geçici ayrıntı önerme.",
		"- Gerçekten kalıcı öğrenim yoksa öneri sunma; tek cümleyle \"kalıcı damıtılacak öğrenim yok\" de.",
		"- Kullanıcı onaylamadan `knowledge/` altına yazma. Onaydan sonra `beyin.py note-create` ile kaynağa bağlı yaz ve `receipt` refs'ine ekle.",
		"- Zaten var olan bir knowledge notunu geliştirmek yeterliyse onu söyle; yeni dosya açma.",
	].join("\n");
}

export default function beyinDamitma(pi: ExtensionAPI) {
	if (DISABLED) {
		debug("devre dışı");
		return;
	}
	const config = loadConfig();

	// Signals accumulated during one turn (agent run).
	let receiptWritten = false; // beyin.py receipt/note-create/task-create
	let vaultWrite = false; // edit/write inside the vault
	let knowledgeWritten = false; // write under knowledge/
	let lastOfferAt = 0;

	function resetTurn(): void {
		receiptWritten = false;
		vaultWrite = false;
		knowledgeWritten = false;
	}

	pi.on("session_start", () => {
		resetTurn();
		lastOfferAt = 0;
	});

	pi.on("before_agent_start", () => {
		// If the previous run ended before reaching settle (abort), clear the leaked signals.
		resetTurn();
	});

	pi.on("tool_result", (event) => {
		if (event.isError) return;
		if (event.toolName === "edit" || event.toolName === "write") {
			const p = String((event.input as { path?: unknown })?.path ?? "");
			if (p && insideVault(p)) {
				vaultWrite = true;
				if (KNOWLEDGE_RE.test(p)) knowledgeWritten = true;
			}
			return;
		}
		if (event.toolName === "bash") {
			const cmd = String((event.input as { command?: unknown })?.command ?? "");
			if (RECEIPT_RE.test(cmd)) receiptWritten = true;
			if (KNOWLEDGE_RE.test(cmd)) knowledgeWritten = true;
			return;
		}
		// Count a Jev advisor call as "memory was touched": asking the advisor and then skipping
		// distillation entirely is the typical leak (in reminder-less projects like work it is the only signal).
		if (event.toolName.startsWith("beyin_jev_")) receiptWritten = true;
	});

	pi.on("agent_before_settle", (event, ctx: ExtensionContext) => {
		const hadMemory = receiptWritten || vaultWrite;
		const hadKnowledge = knowledgeWritten;
		resetTurn();

		if (!config.enabled) return;
		if (event.outcome !== "completed") return;
		// pi passes this flag under `context`, not on the event itself (BoundaryState).
		if (!event.context.canContinue) return;
		if (!hadMemory || hadKnowledge) return;
		if (isExcluded(ctx.cwd)) {
			debug(`çıkarılan proje, susuyorum: ${ctx.cwd}`);
			return;
		}
		const cooldownMs = config.cooldownMinutes * 60 * 1000;
		if (cooldownMs > 0 && Date.now() - lastOfferAt < cooldownMs) {
			debug("cooldown nedeniyle öneri atlandı");
			return;
		}

		lastOfferAt = Date.now();
		debug(`damıtma önerisi enjekte edildi (hadMemory=${hadMemory})`);
		return {
			continue: true,
			entries: [
				{
					type: "custom_message" as const,
					customType: "beyin-distillation",
					display: false,
					content: instruction(config.maxCandidates),
				},
			],
		};
	});

	// Manual trigger: /damitma — asks for the same suggestion right now.
	pi.registerCommand("damitma", {
		description: LANG === "en" ? "Ask for the second-brain distillation offer now" : "İkinci beyin damıtma önerisini şimdi iste",
		handler: async (_args, ctx: ExtensionContext) => {
			pi.sendMessage(
				{ customType: "beyin-distillation", display: false, content: instruction(config.maxCandidates) },
				{ triggerTurn: true },
			);
			ctx.ui.notify(LANG === "en" ? "Distillation offer requested" : "Damıtma önerisi istendi", "info");
		},
	});
}
