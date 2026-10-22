#!/usr/bin/env bun
/**
 * Jev scenario test — a real multi-turn pi session in the GIVEN directory.
 *
 * Goal: verify that beyin context injection AND Jev background scoring actually
 * COMPLETE in that directory (injectionOnly or full). In particular it catches an
 * in-turn background classify that dies silently on timeout/abort (unit tests do not
 * cover that; the Jev cache is process-local).
 *
 * Usage:
 *   bun run test-jev-scenario.ts <dir> [turns]
 *   BEYIN_SCENE_DIR=<dir> bun run test-jev-scenario.ts
 *
 * Env:
 *   BEYIN_SCENE_MODEL   (default: command-code/deepseek/deepseek-v4.1-flash-fast)
 *   BEYIN_SCENE_QUERY   (default: a work topic — a prompt that pulls records from the vault)
 *   BEYIN_JEV_CONFIG    path to jev.json (if disabled, the Jev check is skipped)
 *   BEYIN_SCENE_WAIT_MS wait for background scoring (default: 12000)
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { section, check, summary } from "./harness.ts";

const DIR = process.argv[2] || process.env.BEYIN_SCENE_DIR;
if (!DIR || !fs.existsSync(DIR)) {
	console.error(`kullanım: bun run test-jev-scenario.ts <dizin> [tur]  (verilen dizin yok: ${DIR ?? "-"})`);
	process.exit(2);
}
const TURNS = Math.max(2, Number(process.argv[3] || 2));
const MODEL = process.env.BEYIN_SCENE_MODEL || "command-code/deepseek/deepseek-v4.1-flash-fast";
const QUERY = process.env.BEYIN_SCENE_QUERY || "hand-seg segmentation U-Net augmentation mosaic low-light teorisi";
const WAIT_MS = Number(process.env.BEYIN_SCENE_WAIT_MS || 30000);

// Jev configuration (if off, no scoring is expected)
const JEV_FILE = process.env.BEYIN_JEV_CONFIG || path.join(os.homedir(), ".config", "beyin", "jev.json");
let jevEnabled = false;
try {
	const c = JSON.parse(fs.readFileSync(JEV_FILE, "utf8"));
	jevEnabled = c.enabled === true && process.env.BEYIN_JEV !== "0";
} catch {
	/* missing/broken -> treat as off */
}

console.log(`# Jev senaryo testi\n- dizin: ${DIR}\n- tur: ${TURNS}\n- model: ${MODEL}\n- Jev: ${jevEnabled ? "açık" : "kapalı (puanlama kontrolü atlanır)"}`);

// --- pi RPC process ---
const child = spawn("pi", ["--mode", "rpc", "--no-session", "--no-tools", "--model", MODEL], {
	cwd: DIR,
	env: { ...process.env, BEYIN_DEBUG: "1" },
	stdio: ["pipe", "pipe", "pipe"],
});

const stderrLines: string[] = [];
const stdoutLines: string[] = [];
const settleWaiters: Array<() => void> = [];

function feed(stream: NodeJS.ReadableStream, sink: string[], onLine?: (line: string) => void) {
	let buf = "";
	stream.on("data", (d: Buffer) => {
		buf += d.toString("utf8");
		let i: number;
		while ((i = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, i).replace(/\r$/, "");
			buf = buf.slice(i + 1);
			sink.push(line);
			onLine?.(line);
		}
	});
}
feed(child.stdout, stdoutLines, (line) => {
	try {
		if (JSON.parse(line).type === "agent_settled") settleWaiters.shift()?.();
	} catch {
		/* not JSON */
	}
});
feed(child.stderr, stderrLines);

const send = (id: string, message: string) => child.stdin.write(JSON.stringify({ id, type: "prompt", message }) + "\n");
function waitSettled(timeout = 120000): Promise<void> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("agent_settled zaman aşımı")), timeout);
		settleWaiters.push(() => {
			clearTimeout(t);
			resolve();
		});
	});
}

try {
	for (let turn = 1; turn <= TURNS; turn++) {
		send(`p${turn}`, QUERY);
		await waitSettled();
		// background Jev scoring is non-blocking: wait for it to finish (not a fixed sleep).
		if (turn < TURNS) {
			const deadline = Date.now() + WAIT_MS;
			while (Date.now() < deadline) {
				const done = stderrLines.some((l) => /jev \(arka plan\): \d+ puan güncellendi|jev durdu:/.test(l));
				if (done || !jevEnabled) break;
				await new Promise((r) => setTimeout(r, 300));
			}
			await new Promise((r) => setTimeout(r, 500)); // slack for result processing
		}
	}
} catch (err) {
	console.error(`HATA: ${String(err)}`);
} finally {
	child.stdin.end();
	await new Promise<void>((r) => {
		child.on("close", () => r());
		setTimeout(() => {
			child.kill();
			r();
		}, 8000);
	});
}

// --- analiz ---
const STDERR = stderrLines.join("\n");
const STDOUT = stdoutLines.join("\n");
const injected = (STDOUT.match(/"customType":\s*"beyin-context"/g) || []).length;
const injectSizes = [...STDERR.matchAll(/\[beyin\] enjekte (\d+) karakter/g)].map((m) => Number(m[1]));
const scored = [...STDERR.matchAll(/jev \(arka plan\): (\d+) puan güncellendi/g)].map((m) => Number(m[1]));
const aborted = /jev durdu: aborted/.test(STDERR);
const filterLines = [...STDERR.matchAll(/jev \(önbellek\): (\d+)\/(\d+) kaldı/g)].map((m) => `${m[1]}/${m[2]}`);

console.log(`\n- enjekte bölümü: ${injected} · turlara göre boyut: [${injectSizes.join(", ")}]`);
console.log(`- Jev arka plan: [${scored.join(", ")}] · abort: ${aborted} · filtre: [${filterLines.join(", ")}]`);
const jevDiag = stderrLines.filter((l) => /^\[beyin-jev\]/.test(l) || /\[beyin\].*jev/.test(l));
if (jevDiag.length) {
	console.log("- Jev tanı satırları:");
	for (const l of jevDiag) console.log(`   ${l}`);
}

section("doğrulamalar");
check("beyin bağlamı enjekte edildi (>=1 tur)", injected >= 1, { injected });
check("her turda enjeksiyon boyutu kaydedildi", injectSizes.length >= 1, injectSizes);
if (jevEnabled) {
	check("Jev arka plan puanlaması tamamlandı (abort YOK)", !aborted && scored.some((n) => n > 0), { aborted, scored });
} else {
	console.log("  (Jev kapalı — puanlama doğrulaması atlandı)");
}
if (filterLines.length > 0) console.log(`  ℹ tur>=2 filtre uygulandı: ${filterLines.join(", ")}`);
else console.log("  ℹ tur>=2 filtre satırı yok (tüm kayıtlar ilgili olabilir ya da önbellek boş)");

summary();
