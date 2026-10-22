/**
 * beyin-damitma.ts testleri.
 * Model çağrısı yok; olay akışı ve öneri koşulları doğrulanır.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockPi, makeCtx, check, section, summary } from "./harness.ts";
import { extensionUrl, fixture, tmpDir } from "./fixtures.ts";

const VAULT = process.env.BEYIN_VAULT || path.join(os.homedir(), "projects", "beyin");
const WORK = path.join(os.homedir(), "projects", "work");
/** injectionOnly + `damitma: true` (bilinçli istisna) vakası için sahte "kendi hafızası olan" proje. */
const WORK_SELF = path.join(os.homedir(), "projects", "work-self");
const TMP = tmpDir();
const CFG = path.join(TMP, "damitma.json");
/** Canlı `~/.config/beyin/pi-hook.json`'a bağımlı olmamak için izole hook config'i. */
const HOOK_CFG = fixture("hook.test.json", TMP);

process.env.BEYIN_VAULT = VAULT;
process.env.BEYIN_DAMITMA_CONFIG = CFG;
process.env.BEYIN_HOOK_CONFIG = HOOK_CFG;
process.env.BEYIN_DEBUG = "1";
delete process.env.BEYIN_DISABLE;
delete process.env.BEYIN_DAMITMA;

const { default: factory } = await import(extensionUrl("damitma"));

function writeCfg(cfg: any): void {
	fs.writeFileSync(CFG, JSON.stringify(cfg));
}

/** Yeni factory örneği (config her factory çağrısında okunur). */
function fresh(cfg: any): MockPi {
	writeCfg(cfg);
	const pi = new MockPi();
	factory(pi);
	return pi;
}

/** Bir turu simüle et: (session_start) -> before_agent_start -> tool'lar -> settle. */
async function runTurn(
	pi: MockPi,
	ctx: any,
	tools: Array<{ isError?: boolean; toolName: string; input?: any }> = [],
	settle: any = { outcome: "completed", context: { canContinue: true } },
	sessionStart = true,
): Promise<any[]> {
	if (sessionStart) await pi.fire("session_start", {}, ctx);
	await pi.fire("before_agent_start", {}, ctx);
	for (const t of tools) await pi.fire("tool_result", { isError: false, ...t }, ctx);
	return pi.fire("agent_before_settle", settle, ctx);
}

function hasOffer(results: any[]): boolean {
	const r = results[0];
	return !!r && r.continue === true && /damıtma/i.test(r.entries?.[0]?.content ?? "");
}

section("kayıt");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	check("agent_before_settle handler var", (pi.handlers.get("agent_before_settle") ?? []).length === 1);
	check("/damitma komutu var", pi.commands.has("damitma"));
}

section("öneri koşulları");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "bash", input: { command: "python3 beyin.py receipt --harness pi --event-id e1 --summary s" } },
	]);
	check("receipt + knowledge yok → öneri", hasOffer(r));
	check("öneri custom_message tipinde", r[0]?.entries?.[0]?.type === "custom_message");
	check("öneri display=false", r[0]?.entries?.[0]?.display === false);
	check("öneri maxCandidates içeriyor", /En fazla 3 aday/.test(r[0]?.entries?.[0]?.content ?? ""));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/sonuc.md` } },
	]);
	check("vault yazımı (knowledge değil) + kayıt yok → öneri", hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "write", input: { path: `${VAULT}/knowledge/concepts/x.md` } },
	]);
	check("knowledge yazıldı → öneri yok", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, []);
	check("kayıt yok → öneri yok", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(
		pi,
		makeCtx().ctx,
		[{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }],
		{ outcome: "aborted", context: { canContinue: true } },
	);
	check("outcome=aborted → öneri yok", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(
		pi,
		makeCtx().ctx,
		[{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }],
		{ outcome: "completed", context: { canContinue: false } },
	);
	check("context.canContinue=false → öneri yok", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx({ cwd: WORK }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	check("çıkarılan projede (work) öneri yok", !hasOffer(r));
}
{
	// injectionOnly.<proje>.damitma === true → proje hatırlatmaları kapatmış olsa da damıtma AÇIK kalır.
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx({ cwd: WORK_SELF }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	check("injectionOnly damitma=true → öneri var", hasOffer(r));
}
{
	const pi = fresh({ enabled: false, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } },
	]);
	check("config enabled=false → öneri yok", !hasOffer(r));
}

section("cooldown");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 30, maxCandidates: 3 });
	const ctx = makeCtx().ctx;
	await pi.fire("session_start", {}, ctx); // oturum başına bir kez
	const r1 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	check("ilk turda öneri", hasOffer(r1));
	const r2 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	check("cooldown içinde ikinci öneri yok", !hasOffer(r2));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const ctx = makeCtx().ctx;
	await pi.fire("session_start", {}, ctx);
	const r1 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	const r2 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	check("cooldown=0 → her turda öneri", hasOffer(r1) && hasOffer(r2));
}

section("/damitma komutu");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const { ctx, notes } = makeCtx();
	await pi.commands.get("damitma").handler("", ctx);
	check("sendMessage çağrıldı", pi.sent.length === 1);
	check("mesaj damitma talimatı içeriyor", /damıtma/i.test(pi.sent[0]?.message?.content ?? ""));
	check("bildirim verildi", notes.some((n) => /Damıtma önerisi istendi/.test(n.msg)));
}

summary();
