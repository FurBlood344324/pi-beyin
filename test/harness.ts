/**
 * Shared harness for the beyin pi-native extension tests.
 * Mocks the pi API; extensions are driven through this mock.
 * Uses real beyin.py commands and (optionally) a real CommandCode call.
 */

export type Handler = (event: any, ctx: any) => any;

export class MockPi {
	handlers = new Map<string, Handler[]>();
	commands = new Map<string, any>();
	providers = new Map<string, any>();
	tools = new Map<string, any>();
	sent: any[] = [];

	on(event: string, handler: Handler): () => void {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
		return () => {
			const i = list.indexOf(handler);
			if (i >= 0) list.splice(i, 1);
		};
	}

	registerCommand(name: string, opts: any): void {
		this.commands.set(name, opts);
	}

	registerProvider(name: string, opts: any): void {
		this.providers.set(name, opts);
	}

	registerTool(tool: any): void {
		this.tools.set(tool.name, tool);
	}

	sendMessage(message: any, opts?: any): void {
		this.sent.push({ message, opts });
	}

	fire(event: string, payload: any = {}, ctx: any = {}): Promise<any[]> {
		const list = this.handlers.get(event) ?? [];
		return Promise.all(list.map((h) => h(payload, ctx)));
	}
}

export interface Notify {
	msg: string;
	level?: string;
}

export function makeCtx(overrides: any = {}): { ctx: any; notes: Notify[]; classifyCalls: any[] } {
	const notes: Notify[] = [];
	const classifyCalls: any[] = [];
	const ctx: any = {
		cwd: "/tmp/beyin-ext-test/app",
		mode: "tui",
		ui: {
			notify: (msg: string, level?: string) => notes.push({ msg, level }),
			confirm: async () => true,
		},
		modelRegistry: {
			findOfType: () => undefined,
			classify: async (model: any, context: any, options: any) => {
				classifyCalls.push({ model, context, options });
				return { stopReason: "stop", answers: {} };
			},
			getApiKeyForProvider: async () => undefined,
		},
		...overrides,
	};
	return { ctx, notes, classifyCalls };
}

// ---- assert helpers ----
let pass = 0;
let fail = 0;
const failures: string[] = [];

export function section(name: string): void {
	console.log(`\n## ${name}`);
}

export function check(name: string, cond: boolean, detail?: unknown): void {
	if (cond) {
		pass++;
		console.log(`  \x1b[32m✓\x1b[0m ${name}`);
	} else {
		fail++;
		failures.push(name);
		console.log(`  \x1b[31m✗\x1b[0m ${name}${detail !== undefined ? "  → " + truncate(detail) : ""}`);
	}
}

function truncate(value: unknown): string {
	try {
		const text = typeof value === "string" ? value : JSON.stringify(value);
		return text.length > 300 ? text.slice(0, 300) + "…" : text;
	} catch {
		return String(value);
	}
}

export function summary(): void {
	console.log(`\n=== ${pass} passed, ${fail} failed ===`);
	if (fail > 0) {
		console.log("Başarısızlar: " + failures.join(" | "));
		process.exit(1);
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
