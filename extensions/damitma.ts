/**
 * Beyin damıtma — tur/oturum sonunda knowledge damıtma ÖNERİSİ.
 *
 * Neden: İkinci beynin saf halinde kavram/damıtma işini arka plan modeli değil,
 * aktif ajan yapar (V2 arka plan derleyicisi emekli). Ama "öğrenim damıtıldı mı"
 * adımı sessizce kaçabiliyordu. Bu extension, bir turda ikinci beyne kayıt
 * düşüldüğü halde `knowledge/` altına damıtılmadıysa, tur sonunda ajana kısa bir
 * "damıtma adayı sun" talimatı enjekte eder.
 *
 * Önemli: Otomatik YAZMAZ. Yalnızca ajana "kullanıcıya öneri sun, onay iste"
 * der. Asıl knowledge notunu kullanıcı onayından sonra ajan yazar. Böylece
 * "öneri → kullanıcı onayı → yazım" ilkesi korunur; vault bir çıkarım
 * fabrikasına dönmez.
 *
 * Ne zaman tetikler (hepsi birlikte):
 *   - tur "completed" bitti ve sürdürülebilir (canContinue)
 *   - turda kayıt düşüldü (beyin.py receipt/note-create/task-create), vault'a yazım oldu **veya
 *     `beyin_jev_*` danışmanı çağrıldı** (danışmana sorup damıtmayı atlamak tipik kaçak)
 *   - turda `knowledge/` altına YAZILMADI
 *   - cooldown geçti (varsayılan 30 dk) — her turda rahatsız etmesin
 *
 * Proje istisnası: `pi-hook.json` → `injectionOnly.<proje>.damitma: true` verilirse, o projede
 * reminder'lar kapalı kalsa bile **damıtma önerisi açılır** (work gibi kendi kaydını tutan projelerde
 * "sessizlik" yüzünden damıtımın tamamen kaybolmasını engeller).
 *
 * Yapılandırma: ~/.config/beyin/damitma.json
 *   { "enabled": true, "cooldownMinutes": 30, "maxCandidates": 3 }
 * Ortam: BEYIN_DAMITMA="0" -> kapat; BEYIN_DISABLE="1" -> tümüyle sus;
 *        BEYIN_DEBUG="1" -> stderr tanılama; BEYIN_VAULT -> vault yolu.
 *
 * Vault DIŞINDA yaşar; beyin güncellemeleri dokunmaz.
 */

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HOME = process.env.HOME || homedir();
const VAULT = process.env.BEYIN_VAULT || path.join(HOME, "projects", "beyin");
const CONFIG_FILE = process.env.BEYIN_DAMITMA_CONFIG || path.join(HOME, ".config", "beyin", "damitma.json");
const HOOK_CONFIG_FILE = process.env.BEYIN_HOOK_CONFIG || path.join(HOME, ".config", "beyin", "pi-hook.json");
const DEFAULT_EXCLUDES = [path.join(HOME, "projects", "work")];
const DISABLED = process.env.BEYIN_DAMITMA === "0" || process.env.BEYIN_DISABLE === "1";
const DEBUG = process.env.BEYIN_DEBUG === "1";

const RECEIPT_RE = /(?:^|\s)beyin\.py\s+(?:receipt|note-create|task-create|task-update)\b/;
const KNOWLEDGE_RE = /(^|[\\/])knowledge[\\/]/;

function debug(msg: string): void {
	if (DEBUG) process.stderr.write(`[beyin-damitma] ${msg}\n`);
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

/** Kendi olgun hafıza sistemi olan projeler (ör. work): damıtma önerisi de sussun. */
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
	// injectionOnly projelerde damıtma da sussun (kendi kayıt sistemi olan projelerde çift mekanizma olur).
	try {
		const c = JSON.parse(fs.readFileSync(HOOK_CONFIG_FILE, "utf8")) as Record<string, unknown>;
		if (c.injectionOnly && typeof c.injectionOnly === "object" && !Array.isArray(c.injectionOnly)) {
			for (const project of Object.keys(c.injectionOnly as Record<string, unknown>)) {
				if (typeof project !== "string" || !project) continue;
				const rel = path.relative(project, cwd);
				if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) continue;
				const opts = (c.injectionOnly as Record<string, unknown>)[project];
				// Proje bazlı istisna: reminders kapalı kalsa da damıtma açık olabilir.
				if (opts && typeof opts === "object" && (opts as Record<string, unknown>).damitma === true) continue;
				return true;
			}
		}
	} catch {
		/* config yok → boş geç */
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

	// Bir tur (agent run) boyunca biriken sinyaller.
	let receiptWritten = false; // beyin.py receipt/note-create/task-create
	let vaultWrite = false; // vault içine edit/write
	let knowledgeWritten = false; // knowledge/ altına yazım
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
		// Önceki run settle'a ulaşmadan bitmişse (abort) sızan sinyalleri temizle.
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
		// Jev danışmanı çağrıldıysa "hafızaya dokunuldu" say: danışmana sorup damıtmayı
		// tamamen atlamak en tipik kaçak (work gibi reminder'sız projelerde tek sinyal bu).
		if (event.toolName.startsWith("beyin_jev_")) receiptWritten = true;
	});

	pi.on("agent_before_settle", (event, ctx: ExtensionContext) => {
		const hadMemory = receiptWritten || vaultWrite;
		const hadKnowledge = knowledgeWritten;
		resetTurn();

		if (!config.enabled) return;
		if (event.outcome !== "completed") return;
		// pi bu bayrağı olayın kendisinde değil, `context` altında veriyor (BoundaryState).
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
					customType: "beyin-damitma",
					display: false,
					content: instruction(config.maxCandidates),
				},
			],
		};
	});

	// Elle tetik: /damitma — aynı öneriyi hemen ister.
	pi.registerCommand("damitma", {
		description: "İkinci beyin damıtma önerisini şimdi iste",
		handler: async (_args, ctx: ExtensionContext) => {
			pi.sendMessage(
				{ customType: "beyin-damitma", display: false, content: instruction(config.maxCandidates) },
				{ triggerTurn: true },
			);
			ctx.ui.notify("Damıtma önerisi istendi", "info");
		},
	});
}
