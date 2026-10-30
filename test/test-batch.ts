/**
 * beyin-batch tests. Model-free: `MockPi` records `sendMessage`, nothing leaves the process.
 *
 * The rules under test are the "deliberately quiet" list in extensions/batch.ts: a chain of
 * three single-call turns maps to exactly one note; parallel turns, mixed tools, nested calls
 * and the cooldown stay silent; the cap holds; a missing or throwing `sendMessage` is fail-open.
 */
import { MockPi, check, section, summary } from "./harness.ts";
import { extensionUrl } from "./fixtures.ts";

delete process.env.BEYIN_DISABLE;
delete process.env.BEYIN_BATCH;
delete process.env.SERIAL_NUDGE_OFF;

const batch = await import(extensionUrl("batch"));
const { default: factory, createBatchNudge, looksSerial, noteText, batchNudgeEnabled } = batch;
const { SERIAL_WINDOW, COOLDOWN_TURNS, MAX_NOTES } = batch;

/** Drives one turn with the given tool names. */
function driver(pi: MockPi) {
	let turn = 0;
	return async (...tools: string[]) => {
		turn += 1;
		await pi.fire("turn_start", { turnIndex: turn }, {});
		for (const tool of tools)
			await pi.fire(
				"tool_result",
				{ toolCallId: `t${turn}-${tool}`, toolName: tool, input: {}, content: [{ type: "text", text: "x" }], isError: false },
				{},
			);
		await pi.fire("turn_end", { turnIndex: turn, message: { role: "assistant" }, toolResults: [] }, {});
	};
}

section("chain detection");
{
	const pi = new MockPi();
	factory(pi);
	const turn = driver(pi);

	await turn("bash");
	await turn("bash");
	check("two single-call turns stay silent", pi.sent.length === 0, pi.sent.length);

	await turn("bash");
	check("third single-call turn sends exactly one note", pi.sent.length === 1, pi.sent.length);
	check("note names the tool and the chain length", /\[batch\] 3 ard arda tek çağrı \(bash\)/.test(pi.sent[0]?.message?.content ?? ""), pi.sent[0]?.message?.content);
	check("note never starts a turn (triggerTurn false)", pi.sent[0]?.opts?.triggerTurn === false, pi.sent[0]?.opts);
	check("note stays out of the transcript (display false)", pi.sent[0]?.message?.display === false, pi.sent[0]?.message);
	check("note carries its own customType", pi.sent[0]?.message?.customType === "beyin-batch", pi.sent[0]?.message?.customType);

	for (let i = 0; i < COOLDOWN_TURNS - 1; i++) await turn("bash");
	check("cooldown keeps the next chain quiet", pi.sent.length === 1, pi.sent.length);
}

section("what must stay silent");
{
	const pi = new MockPi();
	factory(pi);
	const turn = driver(pi);
	for (let i = 0; i < 6; i++) await turn("bash", "bash");
	check("parallel turns are not a chain", pi.sent.length === 0, pi.sent.length);
	await turn("bash");
	check("a lone turn after parallel work is still not a chain", pi.sent.length === 0, pi.sent.length);
}
{
	const pi = new MockPi();
	factory(pi);
	for (let i = 1; i <= 5; i++) {
		await pi.fire("turn_start", { turnIndex: i }, {});
		await pi.fire(
			"tool_result",
			{ toolCallId: `n${i}`, parentToolCallId: `p${i}`, toolName: "bash", input: {}, content: [{ type: "text", text: "n" }], isError: false },
			{},
		);
		await pi.fire("turn_end", { turnIndex: i, message: { role: "assistant" }, toolResults: [] }, {});
	}
	check("nested calls never count", pi.sent.length === 0, pi.sent.length);
}
{
	const pi = new MockPi();
	factory(pi);
	const turn = driver(pi);
	await turn("read");
	await turn("edit");
	await turn("bash");
	await turn("grep");
	check("mixed tools in sequence are legitimate serial work", pi.sent.length === 0, pi.sent.length);
}

section("caps and switches");
{
	const pi = new MockPi();
	factory(pi);
	const turn = driver(pi);
	for (let round = 0; round < 20; round++) {
		await turn("bash");
		await turn("bash");
		await turn("bash");
	}
	check(`session cap holds at ${MAX_NOTES}`, pi.sent.length === MAX_NOTES, pi.sent.length);
}
{
	const off = new MockPi();
	createBatchNudge({ off: true })(off);
	check("off switch registers no handlers", off.handlers.size === 0, [...off.handlers.keys()]);
}
check("BEYIN_BATCH=0 disables", (() => {
	process.env.BEYIN_BATCH = "0";
	const off = !batchNudgeEnabled();
	delete process.env.BEYIN_BATCH;
	return off;
})());
check("BEYIN_DISABLE=1 disables", (() => {
	process.env.BEYIN_DISABLE = "1";
	const off = !batchNudgeEnabled();
	delete process.env.BEYIN_DISABLE;
	return off;
})());
check("legacy SERIAL_NUDGE_OFF=1 still disables", (() => {
	process.env.SERIAL_NUDGE_OFF = "1";
	const off = !batchNudgeEnabled();
	delete process.env.SERIAL_NUDGE_OFF;
	return off;
})());
check("enabled by default", batchNudgeEnabled());
{
	const pi = new MockPi() as any;
	const turn = driver(pi);
	pi.sendMessage = () => {
		throw new Error("transport down");
	};
	let threw = false;
	try {
		factory(pi);
		await turn("bash");
		await turn("bash");
		await turn("bash");
	} catch {
		threw = true;
	}
	check("a throwing sendMessage stays fail-open", !threw);
}

section("pure helpers");
check("looksSerial: three identical single-call turns is a chain", (() => {
	const got = looksSerial([
		{ calls: 1, tools: ["bash"] },
		{ calls: 1, tools: ["bash"] },
		{ calls: 1, tools: ["bash"] },
	]);
	return got.serial && got.tool === "bash" && got.repeats === 3;
})());
check("looksSerial: short history is not a chain", !looksSerial([
	{ calls: 1, tools: ["bash"] },
	{ calls: 1, tools: ["bash"] },
]).serial);
check("looksSerial: a parallel turn inside the window breaks it", !looksSerial([
	{ calls: 1, tools: ["bash"] },
	{ calls: 2, tools: ["bash", "read"] },
	{ calls: 1, tools: ["bash"] },
]).serial);
check("noteText is one line", !noteText("bash", 3).includes("\n"));
check("window is 3 and cooldown is 8", SERIAL_WINDOW === 3 && COOLDOWN_TURNS === 8, `${SERIAL_WINDOW}/${COOLDOWN_TURNS}`);

summary();
