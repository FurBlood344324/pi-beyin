/**
 * beyin-context.ts danışman araç testleri (jev-review / jev-answer / jev-memory sarmalayıcıları).
 *
 * Gerçek beyin.py çağrılır; yalnız **yerel doğrulama** hataları tetiklenir (uzak CommandCode
 * çağrısı yapılmaz). Amaç: kayıt, şema, mod kapısı ve JSON stdin köprüsünün çalıştığını kanıtlamak.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockPi, check, section, summary } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

const VAULT = process.env.BEYIN_VAULT || path.join(os.homedir(), "projects", "beyin");
/** Hook config her testte yeniden yazılır; repodaki fixture değişmesin. */
const HOOK_CFG = path.join(tmpDir(), "pi-hook.json");
const SILENT = path.join(tmpDir("beyin-advisor-silent-"));

process.env.BEYIN_VAULT = VAULT;
process.env.BEYIN_HOOK_CONFIG = HOOK_CFG;
process.env.BEYIN_DEBUG = "1";
delete process.env.BEYIN_DISABLE;
fs.mkdirSync(SILENT, { recursive: true });

function writeHook(cfg: unknown): void {
	fs.writeFileSync(HOOK_CFG, JSON.stringify(cfg));
}
writeHook({ excludeProjects: [], injectionOnly: {} });

const { default: factory } = await import(extensionUrl("context"));
const pi = new MockPi();
factory(pi);

const exec = (name: string, params: any, cwd: string) =>
	pi.tools.get(name).execute("t1", params, undefined, undefined, { cwd });
const text = (r: any): string => String(r?.content?.[0]?.text ?? "");

section("danışman araçları kaydı");
for (const name of ["beyin_jev_memory", "beyin_jev_review", "beyin_jev_answer"]) {
	const t = pi.tools.get(name);
	check(`${name} kayıtlı`, !!t);
	check(`${name} açıklama + şema`, typeof t?.description === "string" && !!t?.parameters?.properties);
	check(`${name} sistem-prompt yönergesi`, Array.isArray(t?.promptGuidelines) && t.promptGuidelines.length > 0);
}

section("silent mod kapısı");
writeHook({ excludeProjects: [SILENT], injectionOnly: {} });
{
	const r = await exec(
		"beyin_jev_review",
		{ project: "beyin", claim: "x", evidence: [{ record_id: "d", source_sha256: "0", quote: "q" }] },
		`${SILENT}/app`,
	);
	check("silent → isError", r?.isError === true);
	check("silent → net mesaj ('susuyor')", /susuyor/.test(text(r)), text(r));
}

section("full mod · yerel doğrulama, uzak çağrı yok");
writeHook({ excludeProjects: [], injectionOnly: {} });
{
	const r = await exec(
		"beyin_jev_memory",
		{ project: "beyin", claim: "", evidence: [{ record_id: "d", source_sha256: "0", quote: "q" }] },
		"/tmp/beyin-advisor-full",
	);
	check("memory boş iddia → beyin.py hata JSON", r?.isError === true && /proposal_scope_or_status_invalid/.test(text(r)), text(r));
}
{
	const r = await exec(
		"beyin_jev_review",
		{ project: "beyin", claim: "", evidence: [{ record_id: "d", source_sha256: "0", quote: "q" }] },
		"/tmp/beyin-advisor-full",
	);
	check("review boş iddia → beyin.py hata JSON", r?.isError === true && /proposal_scope_or_status_invalid/.test(text(r)), text(r));
}
{
	const r = await exec("beyin_jev_answer", { project: "beyin", claims: [{ text: "", citations: [] }] }, "/tmp/beyin-advisor-full");
	check("answer geçersiz iddia → beyin.py hata JSON", r?.isError === true && /invalid_claim/.test(text(r)), text(r));
}

section("inject-only mod (work) çalışır, reddedilmez");
writeHook({ excludeProjects: [], injectionOnly: { "/home/furblood/projects/work": { reminders: false } } });
{
	const r = await exec("beyin_jev_answer", { project: "work", claims: [{ text: "", citations: [] }] }, "/home/furblood/projects/work/staj");
	check("work → çalışır (beyin.py yanıtı geldi)", r?.isError === true && /invalid_claim/.test(text(r)), text(r));
}

fs.rmSync(SILENT, { recursive: true, force: true });
summary();
