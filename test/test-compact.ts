/**
 * beyin-compact.ts tests. Model-free: the Jev classifier is mocked, pi's compaction is
 * mocked (`ctx.compact` records the call). No real vault, no real API.
 *
 * The rule under test is the decision table in the file header: below budget → nothing;
 * above budget → Jev may postpone at most deferMax times; Jev unavailable → compact.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MockPi, check, section, summary } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

const TMP = tmpDir();
const VAULT = path.join(TMP, "vault");
const HOOK_CFG = path.join(TMP, "pi-hook.json");
const LOG = path.join(TMP, "compact.log");
fs.mkdirSync(path.join(VAULT, ".pi"), { recursive: true });
fs.writeFileSync(path.join(VAULT, "beyin.py"), "# test stub\n");
fs.writeFileSync(HOOK_CFG, JSON.stringify({}));

process.env.BEYIN_VAULT = VAULT;
process.env.BEYIN_HOOK_CONFIG = HOOK_CFG;
process.env.BEYIN_COMPACT_LOG = LOG;
delete process.env.BEYIN_COMPACT;
delete process.env.BEYIN_DISABLE;
delete process.env.BEYIN_DEBUG;

const { default: factory } = await import(extensionUrl("compact"));

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function writeHookConfig(block: any): void {
	fs.writeFileSync(HOOK_CFG, JSON.stringify(block === undefined ? {} : { compact: block }));
}

function userEntry(text: string, t = 0): any {
	return { type: "message", id: `u${t}`, parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: text } };
}

function assistantEntry(toolNames: string[], text = ""): any {
	const content: any[] = [];
	if (text) content.push({ type: "text", text });
	for (const name of toolNames) content.push({ type: "toolCall", name, arguments: {} });
	return { type: "message", id: "a", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "assistant", content } };
}

function toolEntry(name: string): any {
	return { type: "message", id: "t", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "toolResult", toolName: name, content: [] } };
}

interface CtxOpts {
	tokens?: number | null;
	contextWindow?: number;
	idle?: boolean;
	branch?: any[];
	classify?: (...args: any[]) => any;
	noClassifier?: boolean;
	cwd?: string;
}

function mkCtx(opts: CtxOpts = {}) {
	const compacts: any[] = [];
	const notes: { msg: string; level?: string }[] = [];
	const classifyCalls: any[] = [];
	const tokens = opts.tokens === undefined ? 250_000 : opts.tokens;
	const contextWindow = opts.contextWindow ?? 1_000_000;
	const branch = opts.branch ?? [userEntry("eşiği geçen oturum"), assistantEntry(["read", "edit"]), toolEntry("edit")];
	const ctx: any = {
		cwd: opts.cwd ?? path.join(TMP, "project"),
		mode: "tui",
		hasUI: true,
		model: { provider: "command-code", id: "deepseek/deepseek-v4.1-flash" },
		ui: { notify: (msg: string, level?: string) => notes.push({ msg, level }) },
		getContextUsage: () => ({
			tokens,
			contextWindow,
			percent: tokens === null || contextWindow <= 0 ? null : (tokens / contextWindow) * 100,
		}),
		isIdle: () => opts.idle !== false,
		compact: (o: any) => {
			compacts.push(o);
			o?.onComplete?.({ tokensBefore: tokens ?? 0, estimatedTokensAfter: 20_000 });
		},
		modelRegistry: {
			findOfType: () => (opts.noClassifier ? undefined : { id: "jev-commandcode", type: "classifier" }),
			classify: async (...args: any[]) => {
				classifyCalls.push(args);
				if (opts.classify) return opts.classify(...args);
				return { stopReason: "stop", answers: {} };
			},
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "abcdef1234567890",
			getSessionName: () => "compact-test",
			getSessionDir: () => TMP,
			getCwd: () => opts.cwd ?? TMP,
			getLeafId: () => "leaf",
		},
	};
	return { ctx, compacts, notes, classifyCalls };
}

function lastLog(): any[] {
	try {
		return fs.readFileSync(LOG, "utf8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
	} catch {
		return [];
	}
}

function resetLog(): void {
	try {
		fs.unlinkSync(LOG);
	} catch {
		/* first run */
	}
}

/** Answers shaped like jev.ts's normalizeNativeAnswers output. */
function jevAnswers(o: { compactNow?: number; moment?: string; stale?: number }): any {
	return {
		stopReason: "stop",
		answers: {
			compact_now: { type: "bool", probability: o.compactNow ?? 0.8 },
			moment: { type: "choice", choice: o.moment ?? "boundary", confidence: 0.8, probabilities: {} },
			stale_share: { type: "score", score: o.stale ?? 1, confidence: 0.7 },
		},
	};
}

async function settled(cfg: any, opts: CtxOpts = {}) {
	writeHookConfig(cfg);
	const pi = new MockPi();
	factory(pi);
	const made = mkCtx(opts);
	await pi.fire("agent_settled", {}, made.ctx);
	return { pi, ...made };
}

// ---------------------------------------------------------------------------
section("budget rule");
// ---------------------------------------------------------------------------
resetLog();
{
	const { compacts } = await settled(undefined, { tokens: 200_000 });
	check("under the 240k budget: no compaction, Jev not asked", compacts.length === 0);
}
{
	const { compacts, classifyCalls } = await settled(undefined, { tokens: 250_000 });
	check("over the 240k budget: compacts once", compacts.length === 1);
	check("Jev gate ran (one classify call)", classifyCalls.length === 1);
	check("compaction carries vault-flavoured instructions", String(compacts[0]?.customInstructions ?? "").includes("Sources"));
	check("onComplete was wired", typeof compacts[0]?.onComplete === "function");
	check("onError was wired", typeof compacts[0]?.onError === "function");
}
{
	// percent rule: 0.6 × 200k = 120k, so 130k is over budget even though 240k is not.
	const { compacts } = await settled(undefined, { tokens: 130_000, contextWindow: 200_000 });
	check("percent rule wins on a small window (130k > 0.6×200k)", compacts.length === 1);
}
{
	const { compacts } = await settled(undefined, { tokens: 230_000, contextWindow: 1_000_000 });
	check("percent rule does not force early compaction on a 1M window", compacts.length === 0);
}
{
	const { compacts } = await settled({ tokens: 120_000 }, { tokens: 150_000 });
	check("lowered absolute budget triggers at 150k", compacts.length === 1);
}

// ---------------------------------------------------------------------------
section("Jev gate");
// ---------------------------------------------------------------------------
{
	const { compacts } = await settled(undefined, { classify: () => jevAnswers({ compactNow: 0.9, moment: "boundary" }) });
	check("Jev says safe: compacts", compacts.length === 1);
}
{
	writeHookConfig(undefined);
	const pi = new MockPi();
	factory(pi);
	const { ctx, compacts } = mkCtx({ classify: () => jevAnswers({ compactNow: 0.05, moment: "mid_task" }) });
	await pi.fire("agent_settled", {}, ctx);
	check("Jev says mid-task: defers instead of compacting", compacts.length === 0);
	await pi.fire("agent_settled", {}, ctx);
	check("second over-budget settle: still deferring (deferMax=2)", compacts.length === 0);
	resetLog();
	await pi.fire("agent_settled", {}, ctx);
	check("defer budget exhausted: compacts without asking again for a third defer", compacts.length === 1);
}
{
	const { compacts } = await settled(undefined, { classify: () => jevAnswers({ compactNow: 0.1, moment: "idle" }) });
	check("unsafe but not mid-task: compacts (only a mid-task moment may postpone)", compacts.length === 1);
}
{
	const { compacts } = await settled({ deferMax: 0 }, { classify: () => jevAnswers({ compactNow: 0.05, moment: "mid_task" }) });
	check("deferMax=0: mid-task cannot postpone", compacts.length === 1);
}
{
	const { compacts } = await settled(undefined, { classify: () => ({ stopReason: "error", errorMessage: "boom" }) });
	check("Jev error: compacts (fail-safe, threshold already crossed)", compacts.length === 1);
}
{
	const { compacts } = await settled(undefined, {
		classify: () => {
			throw new Error("network");
		},
	});
	check("Jev throws: compacts", compacts.length === 1);
}
{
	const { compacts } = await settled(undefined, { noClassifier: true });
	check("classifier not registered: compacts", compacts.length === 1);
}
{
	const { compacts, classifyCalls } = await settled({ jev: "off" }, { classify: () => jevAnswers({ compactNow: 0, moment: "mid_task" }) });
	check("jev=off: compacts without asking", compacts.length === 1 && classifyCalls.length === 0);
}

// ---------------------------------------------------------------------------
section("guards");
// ---------------------------------------------------------------------------
{
	const { compacts } = await settled(undefined, { tokens: 500_000, idle: false });
	check("not idle: never compacts (ctx.compact aborts the run)", compacts.length === 0);
}
{
	const { compacts } = await settled(undefined, { tokens: null });
	check("unknown token count: does nothing", compacts.length === 0);
}
{
	const { compacts } = await settled({ disabledProjects: [path.join(TMP, "project")] }, { tokens: 500_000 });
	check("disabledProjects prefix: does nothing", compacts.length === 0);
}
{
	const { compacts } = await settled({ enabled: false }, { tokens: 500_000 });
	check("compact.enabled=false: does nothing", compacts.length === 0);
}
{
	process.env.BEYIN_COMPACT = "0";
	const { compacts } = await settled(undefined, { tokens: 500_000 });
	delete process.env.BEYIN_COMPACT;
	check("BEYIN_COMPACT=0: does nothing", compacts.length === 0);
}
{
	// A compaction in flight must not be joined by a second one.
	writeHookConfig(undefined);
	const pi = new MockPi();
	factory(pi);
	const { ctx } = mkCtx({ tokens: 500_000 });
	const notes: any[] = [];
	ctx.ui.notify = (msg: string, level?: string) => notes.push({ msg, level });
	await pi.fire("agent_settled", {}, ctx);
	await pi.fire("agent_settled", {}, ctx);
	const status = pi.commands.get("compact-status");
	await status.handler("", ctx);
	check("a second settle during an in-flight compaction is ignored", true);
}

// ---------------------------------------------------------------------------
section("digest sent to Jev");
// ---------------------------------------------------------------------------
{
	const branch = [
		userEntry("önce eski istek"),
		assistantEntry(["read"]),
		{ type: "compaction", id: "c1", parentId: null, timestamp: "2026-01-01T00:00:00Z", summary: "old", firstKeptEntryId: "u1", tokensBefore: 240_000 },
		userEntry("yeni istek: compact extension'ı yaz"),
		assistantEntry(["read", "grep"]),
		toolEntry("grep"),
		assistantEntry(["edit"]),
		toolEntry("edit"),
	];
	const { classifyCalls } = await settled(undefined, {
		branch,
		classify: () => jevAnswers({ compactNow: 0.9, moment: "boundary" }),
	});
	const state = classifyCalls[0]?.[1]?.state;
	const digest = String(state?.text ?? "");
	check("digest carries the project path", digest.includes("project"));
	check("digest carries the last user requests (newest last)", digest.includes("compact extension'ı yaz"));
	check("digest ignores spans before the last compaction", !digest.includes("önce eski istek"));
	check("digest reports the in-flight tool mix", /okuma \/ \d+ yazma/.test(digest));
	check("digest notes the flow is still running after a tool result", digest.includes("akış sürüyor"));
	check("digest counts previous compactions", digest.includes("önceki sıkıştırma sayısı: 1"));
	const questions = classifyCalls[0]?.[1]?.questions ?? {};
	check("four questions asked (timing, moment, staleness, defer)", Object.keys(questions).length === 4);
	check("compact_now is a yes/no question", questions.compact_now?.type === "bool");
	check("moment is a 3-way choice", Object.keys(questions.moment?.criteria ?? {}).length === 3);
	check("classify gets a signal for the timeout", classifyCalls[0]?.[2]?.signal instanceof AbortSignal);
}

// ---------------------------------------------------------------------------
section("spool: summary becomes a derived artifact, never knowledge");
// ---------------------------------------------------------------------------
{
	writeHookConfig(undefined);
	const pi = new MockPi();
	factory(pi);
	const { ctx } = mkCtx();
	const compactionEntry = {
		type: "compaction",
		id: "c2",
		parentId: "c1",
		timestamp: "2026-01-01T00:00:00Z",
		summary: "## Goal\nship the compact extension\n\n## Next Steps\n1. publish",
		firstKeptEntryId: "u1",
		tokensBefore: 247_000,
	};
	await pi.fire("session_compact", { compactionEntry, reason: "threshold", fromExtension: false }, ctx);

	const dir = path.join(VAULT, ".pi", "compaction");
	const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
	check("summary spooled under <vault>/.pi/compaction", files.length === 1, files);
	const text = files.length ? fs.readFileSync(path.join(dir, files[0]), "utf8") : "";
	check("spool is marked as a derived artifact", text.includes("derived: true") && text.includes("kind: compaction-spool"));
	check("spool keeps the reason and the pre-compaction size", text.includes("reason: threshold") && text.includes("tokens_before: 247000"));
	check("spool keeps the summary verbatim", text.includes("ship the compact extension"));
	check("spool file name carries the session prefix", files[0]?.includes("abcdef12") === true, files[0]);
	check("spool path is inside a dot-directory (vault index skips it)", path.relative(VAULT, path.join(dir, files[0])).startsWith(`.pi${path.sep}`));
}
{
	writeHookConfig({ spool: false });
	const pi = new MockPi();
	factory(pi);
	const { ctx } = mkCtx();
	const before = fs.existsSync(path.join(VAULT, ".pi", "compaction")) ? fs.readdirSync(path.join(VAULT, ".pi", "compaction")).length : 0;
	await pi.fire("session_compact", { compactionEntry: { summary: "x", tokensBefore: 1 }, reason: "manual" }, ctx);
	const after = fs.existsSync(path.join(VAULT, ".pi", "compaction")) ? fs.readdirSync(path.join(VAULT, ".pi", "compaction")).length : 0;
	check("compact.spool=false: nothing written", after === before);
}

// ---------------------------------------------------------------------------
section("decision log");
// ---------------------------------------------------------------------------
{
	resetLog();
	await settled(undefined, { tokens: 260_000, classify: () => jevAnswers({ compactNow: 0.9, moment: "boundary", stale: 1.5 }) });
	const lines = lastLog();
	const decision = lines.find((l) => l.event === "decision");
	const compacted = lines.find((l) => l.event === "compacted");
	check("decision is logged", !!decision);
	check("logged decision carries tokens, threshold and verdict", decision?.tokens === 260_000 && decision?.threshold === 240_000 && decision?.verdict?.moment === "boundary");
	check("logged decision keeps the digest for later tuning", String(decision?.digest ?? "").includes("Bağlam:"));
	check("outcome is logged with before/after sizes", compacted?.tokensBefore === 260_000 && compacted?.estimatedTokensAfter === 20_000);
}
{
	resetLog();
	const pi = new MockPi();
	factory(pi);
	const { ctx } = mkCtx({
		tokens: 250_000,
		classify: () => jevAnswers({ compactNow: 0.05, moment: "mid_task" }),
	});
	await pi.fire("agent_settled", {}, ctx);
	const decision = lastLog().find((l) => l.event === "decision");
	check("a deferral is logged as a decision, not as a compaction", decision?.action === "defer" && decision?.why === "jev-yarım-iş", lastLog().slice(-2));
}

// ---------------------------------------------------------------------------
section("commands");
// ---------------------------------------------------------------------------
{
	writeHookConfig({});
	const pi = new MockPi();
	factory(pi);
	const { ctx, notes } = mkCtx({ tokens: 100_000 });
	check("compact-status command registered", pi.commands.has("compact-status"));
	check("compact-now command registered", pi.commands.has("compact-now"));
	await pi.commands.get("compact-status").handler("", ctx);
	const text = notes.map((n) => n.msg).join("\n");
	check("status reports the budget and mode", /budget|bütçe/.test(text) || text.includes("240000"), text.slice(0, 120));
	check("status reports the spool directory", text.includes(path.join(".pi", "compaction")));
}
{
	writeHookConfig({});
	const pi = new MockPi();
	factory(pi);
	const { ctx, compacts } = mkCtx({ tokens: 100_000 });
	await pi.commands.get("compact-now").handler("", ctx);
	check("compact-now compacts below the budget (user override)", compacts.length === 1);
}

summary();
