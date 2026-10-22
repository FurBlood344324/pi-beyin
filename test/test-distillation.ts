/**
 * beyin-distillation (extensions/distillation.ts) tests.
 * No model calls; the event flow and the conditions for an offer are verified.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MockPi, makeCtx, check, section, summary } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

const VAULT = process.env.BEYIN_VAULT || path.join(os.homedir(), "projects", "beyin");
const TMP = tmpDir();
const WORK = path.join(TMP, "work");
/** Fake "has its own memory" project for the injectionOnly + `distillation: true` (deliberate exception) case. */
const WORK_SELF = path.join(TMP, "self-tracked");
/** Outside the vault and not excluded: the "diverged project" case. */
const PLAIN = path.join(TMP, "plain");
const CFG = path.join(TMP, "distillation.json");
/** Isolated hook config so we do not depend on the live `~/.config/beyin/pi-hook.json`.
 *  Paths are derived from the test's own HOME; fixed user paths break in CI. */
const HOOK_CFG = path.join(TMP, "pi-hook.json");
fs.writeFileSync(
	HOOK_CFG,
	JSON.stringify({ excludeProjects: [WORK], injectionOnly: { [WORK_SELF]: { reminders: false, damitma: true } } }),
);

process.env.BEYIN_VAULT = VAULT;
process.env.BEYIN_DISTILLATION_CONFIG = CFG;
process.env.BEYIN_HOOK_CONFIG = HOOK_CFG;
process.env.BEYIN_DEBUG = "1";
delete process.env.BEYIN_DISABLE;
delete process.env.BEYIN_DAMITMA;
delete process.env.BEYIN_DISTILLATION;

const { default: factory } = await import(extensionUrl("distillation"));

function writeCfg(cfg: any): void {
	fs.writeFileSync(CFG, JSON.stringify(cfg));
}

/** New factory instance (config is read on every factory call). */
function fresh(cfg: any): MockPi {
	writeCfg(cfg);
	const pi = new MockPi();
	factory(pi);
	return pi;
}

/** Simulate a turn: (session_start) -> before_agent_start -> tools -> settle. */
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

section("registry");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	check("agent_before_settle handler exists", (pi.handlers.get("agent_before_settle") ?? []).length === 1);
	check("/distillation command exists", pi.commands.has("distillation"));
}

section("offer conditions");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "bash", input: { command: "python3 beyin.py receipt --harness pi --event-id e1 --summary s" } },
	]);
	check("receipt + no knowledge → offer", hasOffer(r));
	check("offer has type custom_message", r[0]?.entries?.[0]?.type === "custom_message");
	check("offer display=false", r[0]?.entries?.[0]?.display === false);
	check("message mentions maxCandidates", /en fazla 3/i.test(r[0]?.entries?.[0]?.content ?? ""));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/sonuc.md` } },
	]);
	check("vault write (not knowledge) + no receipt → offer", hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "write", input: { path: `${VAULT}/knowledge/concepts/x.md` } },
	]);
	check("knowledge written → no offer", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, []);
	check("no receipt → no offer", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(
		pi,
		makeCtx().ctx,
		[{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }],
		{ outcome: "aborted", context: { canContinue: true } },
	);
	check("outcome=aborted → no offer", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(
		pi,
		makeCtx().ctx,
		[{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }],
		{ outcome: "completed", context: { canContinue: false } },
	);
	check("context.canContinue=false → no offer", !hasOffer(r));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx({ cwd: WORK }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	check("excluded project (work) → no offer", !hasOffer(r));
}
{
	// injectionOnly.<project>.distillation === true -> distillation stays ON even if the project disabled reminders.
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx({ cwd: WORK_SELF }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	check("injectionOnly distillation=true → offer", hasOffer(r));
}
{
	// Legacy key: `damitma: true` from an older config must keep working.
	fs.writeFileSync(
		HOOK_CFG,
		JSON.stringify({ excludeProjects: [WORK], injectionOnly: { [WORK_SELF]: { reminders: false, damitma: true } } }),
	);
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx({ cwd: WORK_SELF }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	check("legacy injectionOnly damitma=true still honored", hasOffer(r));
}
{
	// Automatic apply outside the vault: the injected text must tell the agent to sync and write.
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 2 });
	const r = await runTurn(pi, makeCtx({ cwd: PLAIN }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	const content: string = r[0]?.entries?.[0]?.content ?? "";
	check("outside the vault → automatic apply", /otomatik|automatic/i.test(content), content.slice(0, 40));
	check("apply mentions sync", /beyin\.py sync/.test(content));
	check("apply needs no user approval", !/kullanıcı onayı|user approves|before the user/i.test(content));
}
{
	// Inside the vault the flow stays a suggestion.
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 2 });
	const r = await runTurn(pi, makeCtx({ cwd: VAULT }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	const content: string = r[0]?.entries?.[0]?.content ?? "";
	check("inside the vault → offer mode", /öneri|offer/i.test(content), content.slice(0, 40));
}
{
	// BEYIN_DISTILLATION_MODE=offer restores the approval flow outside the vault.
	process.env.BEYIN_DISTILLATION_MODE = "offer";
	const mod: any = await import(extensionUrl("distillation", "fresh=mode-offer"));
	delete process.env.BEYIN_DISTILLATION_MODE;
	const pi = new MockPi();
	mod.default(pi);
	const r = await runTurn(pi, makeCtx({ cwd: PLAIN }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	const content: string = r[0]?.entries?.[0]?.content ?? "";
	check("BEYIN_DISTILLATION_MODE=offer → offer mode", /öneri|offer/i.test(content), content.slice(0, 40));
	fs.writeFileSync(
		HOOK_CFG,
		JSON.stringify({ excludeProjects: [WORK], injectionOnly: { [WORK_SELF]: { reminders: false, distillation: true } } }),
	);
}
{
	const pi = fresh({ enabled: false, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx().ctx, [
		{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } },
	]);
	check("config enabled=false → no offer", !hasOffer(r));
}

section("cooldown");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 30, maxCandidates: 3 });
	const ctx = makeCtx().ctx;
	await pi.fire("session_start", {}, ctx); // once per session
	const r1 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	check("offer on the first turn", hasOffer(r1));
	const r2 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	check("no second offer within cooldown", !hasOffer(r2));
}
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const ctx = makeCtx().ctx;
	await pi.fire("session_start", {}, ctx);
	const r1 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	const r2 = await runTurn(pi, ctx, [{ toolName: "bash", input: { command: "beyin.py receipt --harness pi" } }], undefined, false);
	check("cooldown=0 → offer every turn", hasOffer(r1) && hasOffer(r2));
}

section("/distillation command");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const { ctx, notes } = makeCtx();
	await pi.commands.get("distillation").handler("", ctx);
	check("sendMessage called", pi.sent.length === 1);
	check("message contains distillation instructions", /damıt|distill/i.test(pi.sent[0]?.message?.content ?? ""));
	check("notice emitted", notes.some((n) => /Damıtma adımı istendi/.test(n.msg)));
}

summary();
