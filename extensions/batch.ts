/**
 * beyin-batch — notice when tool calls go out one per turn, and say so once per chain.
 *
 * Why: a tool call that sits alone in an assistant message costs a full model turn —
 * latency plus the whole context re-read. Measured over ten days of this vault
 * (103 sessions, 13,761 tool calls): 76% of calls sat in single-call message chains
 * (mean 10.5 steps, longest 249), and only 12% of tool messages carried two or more
 * calls. Independent calls can share one message; dependent or filtered chains belong
 * in one `codemode` script. Both are decisions the model makes *before* the call, so
 * the only useful moment to speak is between turns.
 *
 * How: count tool calls per turn (`turn_start` → 0, `tool_result` → +1, `turn_end` →
 * push). When the last three completed turns each had exactly one call and the same
 * tool appears three times, send one line — and only that, once:
 *
 *   `[batch] 3 ard arda tek çağrı (bash): … tek mesajda paralel / tek codemode script'i`
 *
 * Why `sendMessage` and not an annotated tool result: `read`/`write`/`edit` content is
 * file text, and a trailing note would corrupt it; a message also leaves pi's rendered
 * transcript (and any compact-steps row) untouched. `triggerTurn: false` means the note
 * never starts a turn of its own, so the cost of reminding is one line, not one turn.
 *
 * Deliberately quiet:
 *   - different tools in sequence (read → edit → bash) is legitimate serial work: no note
 *   - nested calls (`parentToolCallId`, e.g. from a codemode script) never count
 *   - at most one note per 8 turns, at most 6 per session
 *   - fail-open: a missing or throwing `sendMessage` changes nothing else
 *
 * Env: BEYIN_BATCH="0" (legacy SERIAL_NUDGE_OFF="1") → off; BEYIN_DISABLE="1" → fully silent.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** How many single-call turns make a chain. */
export const SERIAL_WINDOW = 3;
/** Minimum turns between two notes. */
export const COOLDOWN_TURNS = 8;
/** Hard cap per session. */
export const MAX_NOTES = 6;

export interface TurnStat {
	calls: number;
	tools: string[];
}

/**
 * Are the last `SERIAL_WINDOW` turns single-call, with one tool repeating that often?
 * Single call + same tool = "this work could have shared one message or one script".
 */
export function looksSerial(turns: TurnStat[]): { serial: boolean; tool: string; repeats: number } {
	if (turns.length < SERIAL_WINDOW) return { serial: false, tool: "", repeats: 0 };
	const window = turns.slice(-SERIAL_WINDOW);
	if (window.some((turn) => turn.calls !== 1)) return { serial: false, tool: "", repeats: 0 };

	const counts = new Map<string, number>();
	for (const turn of window) counts.set(turn.tools[0], (counts.get(turn.tools[0]) ?? 0) + 1);

	let best = { tool: "", repeats: 0 };
	for (const [tool, count] of counts) if (count > best.repeats) best = { tool, repeats: count };
	return { serial: best.repeats >= SERIAL_WINDOW, ...best };
}

export function noteText(tool: string, repeats: number): string {
	return `[batch] ${repeats} ard arda tek çağrı (${tool}): bağımsız olanları TEK mesajda paralel gönder; argümanı önceki sonuca bağlı veya ≥5 mekanik adımı tek \`codemode\` script'inde topla. Yargı gerekiyorsa seri kalır.`;
}

export function batchNudgeEnabled(): boolean {
	if (process.env.BEYIN_DISABLE === "1") return false;
	if (process.env.BEYIN_BATCH === "0") return false;
	if (process.env.SERIAL_NUDGE_OFF === "1") return false;
	return true;
}

export function createBatchNudge(options: { off?: boolean } = {}) {
	const off = options.off ?? !batchNudgeEnabled();

	return (pi: ExtensionAPI) => {
		if (off) return;
		const api = pi as any;

		// Per registration, not per module: two sessions in one process (or two test instances)
		// must not share a chain counter or a cooldown clock.
		let current: TurnStat = { calls: 0, tools: [] };
		const turns: TurnStat[] = [];
		let turnIndex = 0;
		let lastNoteTurn = Number.NEGATIVE_INFINITY;
		let notes = 0;

		const reset = () => {
			current = { calls: 0, tools: [] };
			turns.length = 0;
			turnIndex = 0;
			lastNoteTurn = Number.NEGATIVE_INFINITY;
			notes = 0;
		};

		api.on("session_start", reset);

		api.on("turn_start", (event: any) => {
			current = { calls: 0, tools: [] };
			if (typeof event?.turnIndex === "number") turnIndex = event.turnIndex;
		});

		api.on("turn_start", (event: any) => {
			current = { calls: 0, tools: [] };
			if (typeof event?.turnIndex === "number") turnIndex = event.turnIndex;
		});

		api.on("tool_result", (event: any) => {
			if (event.parentToolCallId) return;
			current.calls += 1;
			current.tools.push(String(event.toolName));
		});

		api.on("turn_end", () => {
			if (current.calls === 0) return;
			turns.push(current);
			if (turns.length > 32) turns.shift();
			current = { calls: 0, tools: [] };

			if (notes >= MAX_NOTES) return;
			const found = looksSerial(turns);
			if (!found.serial) return;
			if (turnIndex - lastNoteTurn < COOLDOWN_TURNS) return;
			if (typeof api.sendMessage !== "function") return;

			lastNoteTurn = turnIndex;
			notes += 1;
			try {
				api.sendMessage({ customType: "beyin-batch", content: noteText(found.tool, found.repeats), display: false }, { triggerTurn: false });
			} catch {
				/* fail-open: a note we could not deliver is not worth a warning */
			}
		});
	};
}

export default createBatchNudge();
