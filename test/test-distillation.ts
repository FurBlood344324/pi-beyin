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
/** Fake "has its own memory" project for the injectionOnly + `damitma: true` (deliberate exception) case. */
const WORK_SELF = path.join(TMP, "self-tracked");
const CFG = path.join(TMP, "damitma.json");
/** Isolated hook config so we do not depend on the live `~/.config/beyin/pi-hook.json`.
 *  Paths are derived from the test's own HOME; fixed user paths break in CI. */
const HOOK_CFG = path.join(TMP, "pi-hook.json");
fs.writeFileSync(
	HOOK_CFG,
	JSON.stringify({ excludeProjects: [WORK], injectionOnly: { [WORK_SELF]: { reminders: false, damitma: true } } }),
);

process.env.BEYIN_VAULT = VAULT;
process.env.BEYIN_DAMITMA_CONFIG = CFG;
process.env.BEYIN_HOOK_CONFIG = HOOK_CFG;
process.env.BEYIN_DEBUG = "1";
delete process.env.BEYIN_DISABLE;
delete process.env.BEYIN_DAMITMA;

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
	check("/damitma command exists", pi.commands.has("damitma"));
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
	check("offer mentions maxCandidates", /En fazla 3 aday/.test(r[0]?.entries?.[0]?.content ?? ""));
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
	// injectionOnly.<project>.damitma === true -> distillation stays ON even if the project disabled reminders.
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const r = await runTurn(pi, makeCtx({ cwd: WORK_SELF }).ctx, [
		{ toolName: "write", input: { path: `${VAULT}/notes/x.md` } },
	]);
	check("injectionOnly damitma=true → offer", hasOffer(r));
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

section("/damitma command");
{
	const pi = fresh({ enabled: true, cooldownMinutes: 0, maxCandidates: 3 });
	const { ctx, notes } = makeCtx();
	await pi.commands.get("damitma").handler("", ctx);
	check("sendMessage called", pi.sent.length === 1);
	check("message contains damitma instructions", /damıtma/i.test(pi.sent[0]?.message?.content ?? ""));
	check("notice emitted", notes.some((n) => /Damıtma önerisi istendi/.test(n.msg)));
}

summary();
