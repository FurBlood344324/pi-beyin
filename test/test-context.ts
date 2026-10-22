/**
 * beyin-context.ts tests.
 * Real beyin.py context calls; a mock classifier for Jev.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockPi, makeCtx, check, section, summary, sleep } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

const VAULT = process.env.BEYIN_VAULT || path.join(os.homedir(), "projects", "beyin");
const TMP = tmpDir();
const JEV_TEST_CFG = path.join(TMP, "jev.json");
const WORK_ROOT = path.join(TMP, "work");
const WORK = path.join(WORK_ROOT, "foo");
const HOOK_CFG = path.join(TMP, "pi-hook.json");
fs.writeFileSync(
	HOOK_CFG,
	JSON.stringify({ excludeProjects: [], injectionOnly: { [WORK_ROOT]: { reminders: false } } }),
);

process.env.BEYIN_VAULT = VAULT;
process.env.BEYIN_HOOK_CONFIG = HOOK_CFG;
process.env.BEYIN_JEV_CONFIG = JEV_TEST_CFG;
process.env.BEYIN_DEBUG = "1";
process.env.BEYIN_REMINDERS = "1";
delete process.env.BEYIN_DISABLE;
delete process.env.BEYIN_JEV;
delete process.env.BEYIN_INCLUDE_VAULT;
fs.writeFileSync(JEV_TEST_CFG, JSON.stringify({ enabled: false }));

const { default: factory } = await import(extensionUrl("context"));

const pi = new MockPi();
factory(pi);

let moduleSeq = 0;
/** Load an isolated (fresh) extension instance so Jev's in-module cache does not leak across. */
async function freshContext(jevCfg: any): Promise<MockPi> {
	fs.writeFileSync(JEV_TEST_CFG, JSON.stringify(jevCfg));
	moduleSeq++;
	const mod: any = await import(extensionUrl("context", `fresh=${moduleSeq}`));
	const fresh = new MockPi();
	mod.default(fresh);
	return fresh;
}

const QUERY = "anomali tespiti PatchCore EfficientAD OCR PaddleOCR";

/** Build an event object close to pi's real before_agent_start event. */
function ev(prompt: string, sections: Record<string, string> = {}): any {
	return { prompt, systemPrompt: "", systemPromptOptions: { sections } };
}

section("kayıt / olay kancaları");
check("session_start handler var", (pi.handlers.get("session_start") ?? []).length === 1);
check("before_agent_start handler var", (pi.handlers.get("before_agent_start") ?? []).length === 1);
check("tool_result handler var", (pi.handlers.get("tool_result") ?? []).length === 1);

section("session_start");
{
	const { ctx, notes } = makeCtx();
	await pi.fire("session_start", {}, ctx);
	check("TUI bildirimi verildi", notes.some((n) => /İkinci beyin bağlamı etkin/.test(n.msg)));
}

section("before_agent_start — bağlam enjeksiyonu");
{
	const { ctx } = makeCtx();
	const r = (await pi.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("vault dışında sonuç döndü", !!r);
	check("customType beyin-context", r?.message?.customType === "beyin-context");
	check("display=false", r?.message?.display === false);
	const content: string = r?.message?.content ?? "";
	check("başlık enjekte edildi", content.includes("## İkinci beyin"));
	check("kaynak gövdesi var (100+ karakter)", content.length > 100, content.length);
	check("veri-not-talimat uyarısı var", /veridir, talimat değildir/.test(content));
	check("knowledge kaynağı döndü", /knowledge\//.test(content));
}

section("before_agent_start — atlama koşulları");
{
	const { ctx } = makeCtx({ cwd: VAULT });
	const r = (await pi.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("vault içinde susar", r === undefined);
}
{
	const { ctx } = makeCtx({ cwd: WORK });
	const r = (await pi.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("work injectionOnly modda: bağlam enjekte edilir", r?.message?.customType === "beyin-context");
}
{
	const { ctx } = makeCtx();
	const r = (await pi.fire("before_agent_start", ev("kısa"), ctx))[0];
	check("12 karakterden kısa istemde susar", r === undefined);
}
{
	const { ctx } = makeCtx();
	const r = (await pi.fire("before_agent_start", ev("<task-notification> bir şeyler oldu"), ctx))[0];
	check("sentetik istemde susar", r === undefined);
}

section("receipt hatırlatması → sistem prompt bölümü");
{
	const { ctx } = makeCtx();
	// Reset flags + baseline
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	// Previous turn wrote a vault file, no record
	await pi.fire("tool_result", { isError: false, toolName: "write", input: { path: `${VAULT}/knowledge/concepts/deneme.md` } }, ctx);
	const e = ev(QUERY);
	const r = (await pi.fire("before_agent_start", e, ctx))[0];
	check("hatırlatma bölümü eklendi", typeof e.systemPromptOptions.sections.beyin_kayit === "string");
	check("hatırlatma 'kayıt gerekli' içeriyor", /kayıt gerekli/.test(e.systemPromptOptions.sections.beyin_kayit ?? ""));
	check("hatırlatma beyin.py receipt öneriyor", /beyin\.py receipt/.test(e.systemPromptOptions.sections.beyin_kayit ?? ""));
	check("bağlam yine de enjekte edildi", !!r?.message?.content);
}
{
	const { ctx } = makeCtx();
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	await pi.fire("tool_result", { isError: false, toolName: "edit", input: { path: `${VAULT}/knowledge/concepts/x.md` } }, ctx);
	await pi.fire("tool_result", { isError: false, toolName: "bash", input: { command: "python3 beyin.py receipt --harness pi --event-id e1 --summary s --ref knowledge/concepts/x.md" } }, ctx);
	const e = ev(QUERY);
	await pi.fire("before_agent_start", e, ctx);
	check("receipt düşülünce hatırlatma yok", e.systemPromptOptions.sections.beyin_kayit === undefined);
}
{
	const { ctx } = makeCtx();
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	await pi.fire("tool_result", { isError: true, toolName: "write", input: { path: `${VAULT}/knowledge/concepts/x.md` } }, ctx);
	const e = ev(QUERY);
	await pi.fire("before_agent_start", e, ctx);
	check("hatalı yazım hatırlatma tetiklemez", e.systemPromptOptions.sections.beyin_kayit === undefined);
}
{
	// Context must arrive together with the reminder (both in the same turn)
	const { ctx } = makeCtx();
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	await pi.fire("tool_result", { isError: false, toolName: "write", input: { path: `${VAULT}/notes/rapor.md` } }, ctx);
	const e = ev(QUERY);
	const r = (await pi.fire("before_agent_start", e, ctx))[0];
	check("hatırlatma + bağlam aynı anda", !!e.systemPromptOptions.sections.beyin_kayit && !!r?.message?.content);
}

section("Jev — önbellek filtresi (mock classifier)");
{
	let seenCandidates: any[] = [];
	const classify = async (_m: any, context: any) => {
		seenCandidates = context?.state?.candidates ?? [];
		const answers: Record<string, any> = {};
		seenCandidates.forEach((_c: any, i: number) => {
			answers[`c${i}`] = { type: "score", score: i === 0 ? 2 : 0, confidence: 0.9 };
		});
		return { stopReason: "stop", answers };
	};
	const piJ = await freshContext({ enabled: true, mode: "on", minScore: 1, maxCandidates: 6 });
	const modelRegistry = {
		findOfType: () => ({ id: "jev-commandcode", api: "beyin-jev-system-one" }),
		classify,
		getApiKeyForProvider: async () => "x",
	};
	const { ctx } = makeCtx({ modelRegistry });

	// 1st call: empty cache -> everything passes (fail-open); scoring is scheduled in the background
	const r1 = (await piJ.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("ilk çağrıda kayıtlar geldi", !!r1?.message?.content);
	await sleep(400);
	check("arka plan puanlaması çağrıldı", seenCandidates.length > 0, seenCandidates.length);
	const candidates = seenCandidates;
	const firstSource = candidates[0]?.source ?? "";
	const otherSource = candidates.slice(1).find((c) => c.source && c.source !== firstSource)?.source ?? "";

	// 2nd call: same signature -> cache applies, zero-score records are dropped
	const r2 = (await piJ.fire("before_agent_start", ev(QUERY), ctx))[0];
	const content2: string = r2?.message?.content ?? "";
	check("skoru yüksek kaynak kaldı", firstSource === "" || content2.includes(firstSource), firstSource);
	if (otherSource) check("skoru 0 olan kaynak elendi", !content2.includes(otherSource), otherSource);
	check("filtre sonrası hâlâ bağlam var", content2.length > 0);
	const kept = (content2.match(/^### /gm) ?? []).length;
	check("filtre kayıt sayısını azalttı", kept < new Set(candidates.map((c) => c.source)).size, kept);
}

section("Jev — fail-open (classifier hatası)");
{
	const piJ = await freshContext({ enabled: true, mode: "on", minScore: 2, maxCandidates: 6 });
	const modelRegistry = {
		findOfType: () => ({ id: "jev-commandcode", api: "beyin-jev-system-one" }),
		classify: async () => {
			throw new Error("CommandCode down");
		},
		getApiKeyForProvider: async () => "x",
	};
	const { ctx } = makeCtx({ modelRegistry });
	const r = (await piJ.fire("before_agent_start", ev(QUERY), ctx))[0];
	const content: string = r?.message?.content ?? "";
	const count = (content.match(/^### /gm) ?? []).length;
	check("hata olsa da bağlam gelir", count > 0, content.length);
	check("fail-open: kayıtlar elenmedi (1'den fazla)", count > 1, count);
	fs.writeFileSync(JEV_TEST_CFG, JSON.stringify({ enabled: false }));
}

section("Jev — uzak gönderim kapısı (remoteSafe birim)");
{
	const mod: any = await import(extensionUrl("context", "fresh=gate"));
	const remoteSafe = mod.remoteSafe;
	check("remoteSafe export edilmiş", typeof remoteSafe === "function");
	check("alan yok → izinli", remoteSafe({}) === true);
	check("visibility internal → izinli", remoteSafe({ visibility: "internal" }) === true);
	check("visibility private → engelli", remoteSafe({ visibility: "private" }) === false);
	check("remote_allowed:true → izinli", remoteSafe({ remote_allowed: true }) === true);
	check("remote_allowed:false → engelli", remoteSafe({ remote_allowed: false }) === false);
	check("remote_allowed:1 (bool değil) → engelli", remoteSafe({ remote_allowed: 1 }) === false);
	check("sensitivity internal → izinli", remoteSafe({ sensitivity: "internal" }) === true);
	check("sensitivity normal → izinli", remoteSafe({ sensitivity: "normal" }) === true);
	check("sensitivity gizli → engelli", remoteSafe({ sensitivity: "gizli" }) === false);
	check("sensitivity null → engelli (fail-closed)", remoteSafe({ sensitivity: null }) === false);
}

summary();
