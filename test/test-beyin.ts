/**
 * Tests for extensions/beyin.ts (the thin adapter): command resolution, the injected block,
 * the once-per-session-and-cwd guard, the session-start knock and fail-open behaviour.
 * The beyin CLI is a fake node script; no vault, model or network is involved.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { check, MockPi, section, sleep, summary } from "./harness.ts";
import { extensionUrl, tmpDir } from "./fixtures.ts";

const mod = await import(extensionUrl("beyin"));
const { commandFor, projectOf, contextBlock, knock } = mod;
const beyinPi = mod.default;

const dir = tmpDir();
const fake = path.join(dir, "fake-beyin.js");
fs.writeFileSync(
	fake,
	[
		'import fs from "node:fs";',
		"const a = process.argv.slice(2);",
		'if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, a.join(" ") + "\\n");',
		'if (a[0] === "context") {',
		"  if (process.env.FAKE_FAIL) process.exit(2);",
		'  process.stdout.write(process.env.FAKE_BLOCK ?? "BLOCK " + a.join(" "));',
		"}",
		"",
	].join("\n"),
);
const log = path.join(dir, "calls.log");

section("commandFor");
check("default is `beyin` on PATH", commandFor({}).file === "beyin" && commandFor({}).prefix.length === 0);
check("BEYIN_CLI wins", commandFor({ BEYIN_CLI: "/x/beyin.js" }).prefix[0] === "/x/beyin.js");
check(
	"BEYIN_PACKAGE_ROOT points at bin/beyin.js",
	commandFor({ BEYIN_PACKAGE_ROOT: "/pkg" }).prefix[0] === path.join("/pkg", "bin", "beyin.js"),
);

section("projectOf");
check("basename of the cwd", projectOf("/home/u/projects/work") === "work");
check("empty and root give undefined", projectOf("") === undefined && projectOf("/") === undefined);

section("contextBlock");
const env = { ...process.env, BEYIN_CLI: fake, FAKE_LOG: log };
check("returns the CLI bytes, tagged with the project", (await contextBlock("/p/work", env)) === "BLOCK context --project work");
check("a failing CLI gives an empty string", (await contextBlock("/p/work", { ...env, FAKE_FAIL: "1" })) === "");
check("a missing CLI gives an empty string", (await contextBlock("/p/work", { PATH: "/nonexistent" })) === "");

section("before_agent_start guard");
process.env.BEYIN_CLI = fake;
process.env.FAKE_LOG = log;
const pi = new MockPi();
beyinPi(pi);
const ctxA = { cwd: "/p/alpha" };
const first = (await pi.fire("before_agent_start", {}, ctxA))[0];
check("first call injects a hidden beyin-context message", first?.message?.customType === "beyin-context" && first.message.display === false, first);
check("the block names the project", String(first?.message?.content).includes("--project alpha"), first);
check("same cwd again injects nothing", (await pi.fire("before_agent_start", {}, ctxA))[0] === undefined);
const other = (await pi.fire("before_agent_start", {}, { cwd: "/p/beta" }))[0];
check("a cwd change injects again", String(other?.message?.content).includes("--project beta"), other);
check("no cwd injects nothing", (await pi.fire("before_agent_start", {}, {}))[0] === undefined);

section("session_start");
fs.rmSync(log, { force: true });
await pi.fire("session_start", {}, ctxA);
const again = (await pi.fire("before_agent_start", {}, ctxA))[0];
check("session_start resets the guard", again?.message?.customType === "beyin-context", again);
let calls = "";
for (let i = 0; i < 40 && !(calls.includes("ingest --all") && calls.includes("dream --once")); i++) {
	await sleep(100);
	calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
}
check("knock ran `ingest --all`", calls.includes("ingest --all"), calls);
check("knock ran `dream --once`", calls.includes("dream --once"), calls);
check("ingest ran before dream", calls.indexOf("ingest --all") < calls.indexOf("dream --once"), calls);

section("fail open");
process.env.FAKE_FAIL = "1";
const quiet = new MockPi();
beyinPi(quiet);
let threw = false;
try {
	const out = (await quiet.fire("before_agent_start", {}, { cwd: "/p/gamma" }))[0];
	check("failing CLI injects nothing", out === undefined, out);
	await quiet.fire("session_start", {}, {});
} catch {
	threw = true;
}
check("no handler throws", !threw);
delete process.env.FAKE_FAIL;
let knockThrew = false;
try {
	knock({ BEYIN_CLI: path.join(dir, "does-not-exist.js"), PATH: process.env.PATH });
} catch {
	knockThrew = true;
}
check("knock never throws", !knockThrew);

summary();
