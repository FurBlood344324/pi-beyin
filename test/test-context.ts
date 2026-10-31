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

// The query must match a phrase from *your* vault; the default is deliberately neutral so the
// public repo carries no project detail. Set BEYIN_TEST_QUERY to run the injection assertions.
const QUERY = process.env.BEYIN_TEST_QUERY || "second brain notes";

if (!process.env.BEYIN_TEST_QUERY) {
	const { execFileSync } = await import("node:child_process");
	let count = 0;
	try {
		const out = execFileSync("python3", [path.join(VAULT, "beyin.py"), "context", "--no-sync", "--json", QUERY], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		count = (JSON.parse(out).records ?? []).length;
	} catch {
		count = 0;
	}
	if (count < 2) {
		console.log(
			`(skipped: ${count} records match the neutral query. Set BEYIN_TEST_QUERY to a phrase ` +
				"from your vault to run the injection assertions.)",
		);
		process.exit(0);
	}
}

/** Build an event object close to pi's real before_agent_start event. */
function ev(prompt: string, sections: Record<string, string> = {}): any {
	return { prompt, systemPrompt: "", systemPromptOptions: { sections } };
}

section("registry / event hooks");
check("session_start handler exists", (pi.handlers.get("session_start") ?? []).length === 1);
check("before_agent_start handler exists", (pi.handlers.get("before_agent_start") ?? []).length === 1);
check("tool_result handler exists", (pi.handlers.get("tool_result") ?? []).length === 1);

section("session_start");
{
	const { ctx, notes } = makeCtx();
	await pi.fire("session_start", {}, ctx);
	check("TUI notice emitted", notes.some((n) => /İkinci beyin bağlamı etkin/.test(n.msg)));
}

section("before_agent_start — context injection");
{
	const { ctx } = makeCtx();
	const r = (await pi.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("returns a result outside the vault", !!r);
	check("customType beyin-context", r?.message?.customType === "beyin-context");
	check("display=false", r?.message?.display === false);
	const content: string = r?.message?.content ?? "";
	check("heading injected", content.includes("## İkinci beyin"));
	check("source body present (100+ chars)", content.length > 100, content.length);
	check("data-not-instructions warning present", /veridir, talimat değildir/.test(content));
	check("vault source returned", /(?:knowledge|notes|tasks)\//.test(content));
}

section("before_agent_start — skip conditions");
{
	const { ctx } = makeCtx({ cwd: VAULT });
	const r = (await pi.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("silent inside the vault", r === undefined);
}
{
	const { ctx } = makeCtx({ cwd: WORK });
	const r = (await pi.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("work in injectionOnly mode: context injected", r?.message?.customType === "beyin-context");
}
{
	const { ctx } = makeCtx();
	const r = (await pi.fire("before_agent_start", ev("kısa"), ctx))[0];
	check("silent on prompts shorter than 12 chars", r === undefined);
}
{
	const { ctx } = makeCtx();
	const r = (await pi.fire("before_agent_start", ev("<task-notification> bir şeyler oldu"), ctx))[0];
	check("silent on synthetic prompts", r === undefined);
}

section("receipt reminder → system prompt section");
{
	const { ctx } = makeCtx();
	// Reset flags + baseline
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	// Previous turn wrote a vault file, no record
	await pi.fire("tool_result", { isError: false, toolName: "write", input: { path: `${VAULT}/knowledge/concepts/deneme.md` } }, ctx);
	const e = ev(QUERY);
	const r = (await pi.fire("before_agent_start", e, ctx))[0];
	check("reminder section added", typeof e.systemPromptOptions.sections.beyin_kayit === "string");
	check("reminder contains 'kayıt gerekli'", /kayıt gerekli/.test(e.systemPromptOptions.sections.beyin_kayit ?? ""));
	check("reminder suggests beyin.py receipt", /beyin\.py receipt/.test(e.systemPromptOptions.sections.beyin_kayit ?? ""));
	check("context still injected", !!r?.message?.content);
}
{
	const { ctx } = makeCtx();
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	await pi.fire("tool_result", { isError: false, toolName: "edit", input: { path: `${VAULT}/knowledge/concepts/x.md` } }, ctx);
	await pi.fire("tool_result", { isError: false, toolName: "bash", input: { command: "python3 beyin.py receipt --harness pi --event-id e1 --summary s --ref knowledge/concepts/x.md" } }, ctx);
	const e = ev(QUERY);
	await pi.fire("before_agent_start", e, ctx);
	check("no reminder once a receipt is written", e.systemPromptOptions.sections.beyin_kayit === undefined);
}
{
	const { ctx } = makeCtx();
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	await pi.fire("tool_result", { isError: true, toolName: "write", input: { path: `${VAULT}/knowledge/concepts/x.md` } }, ctx);
	const e = ev(QUERY);
	await pi.fire("before_agent_start", e, ctx);
	check("failed write does not trigger a reminder", e.systemPromptOptions.sections.beyin_kayit === undefined);
}
{
	// Context must arrive together with the reminder (both in the same turn)
	const { ctx } = makeCtx();
	await pi.fire("before_agent_start", ev(QUERY), ctx);
	await pi.fire("tool_result", { isError: false, toolName: "write", input: { path: `${VAULT}/notes/rapor.md` } }, ctx);
	const e = ev(QUERY);
	const r = (await pi.fire("before_agent_start", e, ctx))[0];
	check("reminder + context in the same turn", !!e.systemPromptOptions.sections.beyin_kayit && !!r?.message?.content);
}

section("Jev — karar (sahte jev-pick, ağ yok)");
{
	// The decision policy lives in tools/jev-pick.py; here we stub it and check what the
	// extension does with an answer: deliver only the judged notes, and stay silent otherwise.
	process.env.BEYIN_PICK = path.join(import.meta.dir, "fake-pick.py");
	process.env.FAKE_PICK_MODE = "first";
	const piJ = await freshContext({ enabled: true, mode: "on", maxCandidates: 6 });
	const { ctx } = makeCtx();
	const r1 = (await piJ.fire("before_agent_start", ev(QUERY), ctx))[0];
	const content1: string = r1?.message?.content ?? "";
	const n1 = (content1.match(/^### /gm) ?? []).length;
	check("karar verildi: tek not teslim", n1 === 1, n1);
	check("teslim edilen not başlık taşır", content1.includes("### "));

	// A second turn with the same pool: the note was already delivered, so it is not repeated.
	const r2 = (await piJ.fire("before_agent_start", ev(QUERY), ctx))[0];
	check("aynı not tekrar enjekte edilmez", !r2?.message?.content);

	// "none"/below-floor: nothing is injected (the old fail-open path injected the whole pool).
	process.env.FAKE_PICK_MODE = "none";
	const piS = await freshContext({ enabled: true, mode: "on", maxCandidates: 6 });
	const s1 = (await piS.fire("before_agent_start", ev(QUERY), makeCtx().ctx))[0];
	check("karar 'sus' ise hiçbir şey enjekte edilmez", !s1?.message?.content);

	// Judge error / timeout: fail-closed, still no crash.
	process.env.FAKE_PICK_MODE = "error";
	const piE = await freshContext({ enabled: true, mode: "on", maxCandidates: 6 });
	const e1 = (await piE.fire("before_agent_start", ev(QUERY), makeCtx().ctx))[0];
	check("jev-pick hatası -> sessizlik (fail-closed)", !e1?.message?.content);

	// shadow: judged and logged, the pool is delivered unchanged (measurement mode).
	process.env.FAKE_PICK_MODE = "none";
	const piSh = await freshContext({ enabled: true, mode: "shadow", maxCandidates: 6 });
	const sh = (await piSh.fire("before_agent_start", ev(QUERY), makeCtx().ctx))[0];
	const nsh = ((sh?.message?.content ?? "").match(/^### /gm) ?? []).length;
	check("shadow: havuz yine de enjekte edilir", nsh >= 1, nsh);

	delete process.env.BEYIN_PICK;
	delete process.env.FAKE_PICK_MODE;
	fs.writeFileSync(JEV_TEST_CFG, JSON.stringify({ enabled: false }));
}

section("Jev — havuz hijyeni");
{
	// The session already carries the companion files and AGENTS.md; a candidate slot for them is waste.
	process.env.FAKE_PICK_MODE = "first";
	const piH = await freshContext({ enabled: true, mode: "shadow", maxCandidates: 6 });
	const r = (await piH.fire("before_agent_start", ev(QUERY), makeCtx().ctx))[0];
	const content: string = r?.message?.content ?? "";
	const bad = ["### 🔮 850-Companion/", "### knowledge/v3/", "### daily/", "### receipts/", "### journal/", "### AGENTS.md"];
	const found = bad.filter((b) => content.includes(b));
	check("companion/v3/günlük/fiş aday değil", found.length === 0, found.join(","));
	delete process.env.FAKE_PICK_MODE;
	fs.writeFileSync(JEV_TEST_CFG, JSON.stringify({ enabled: false }));
}

section("Jev — remote-send gate (remoteSafe unit)");
{
	const mod: any = await import(extensionUrl("context", "fresh=gate"));
	const remoteSafe = mod.remoteSafe;
	check("remoteSafe exported", typeof remoteSafe === "function");
	check("no field → allowed", remoteSafe({}) === true);
	check("visibility internal → allowed", remoteSafe({ visibility: "internal" }) === true);
	check("visibility private → blocked", remoteSafe({ visibility: "private" }) === false);
	check("remote_allowed:true → allowed", remoteSafe({ remote_allowed: true }) === true);
	check("remote_allowed:false → blocked", remoteSafe({ remote_allowed: false }) === false);
	check("remote_allowed:1 (not a bool) → blocked", remoteSafe({ remote_allowed: 1 }) === false);
	check("sensitivity internal → allowed", remoteSafe({ sensitivity: "internal" }) === true);
	check("sensitivity normal → allowed", remoteSafe({ sensitivity: "normal" }) === true);
	check("sensitivity gizli → blocked", remoteSafe({ sensitivity: "gizli" }) === false);
	check("sensitivity null → blocked (fail-closed)", remoteSafe({ sensitivity: null }) === false);
}

summary();
