/**
 * beyin on pi: the thin adapter (docs/design/04-adapters.md sections 4-6 and 8).
 *
 * Two seams and no tools. The model reaches the vault through the `beyin`
 * skill, which runs the CLI; pi gets no registered tools (04 section 7,
 * option A), so every definition is not paid in every request.
 *
 *   session_start      knock: `beyin ingest --all`, then `beyin dream --once`, detached
 *   before_agent_start inject `beyin context` once per session, again on a cwd change
 *
 * Nothing here formats the block: the CLI owns the bytes and the 4,900 B
 * budget (src/context.js:23), so both harnesses print the same text. Every
 * failure is swallowed (AGENTS.md principle 9): a broken adapter must not break
 * the session, and an empty vault must inject nothing rather than a frame.
 */
import { execFile, spawn } from "node:child_process";
import { basename, join } from "node:path";

const CONTEXT_TIMEOUT_MS = 3000;

export interface PiExtensionApi {
  on(event: string, handler: (event: any, ctx: any) => any): unknown;
}

/**
 * Where the CLI is. The vault root is the CLI's own business (BEYIN_ROOT, then
 * ~/.config/beyin/config.json, then ~/beyin), so this adapter names no vault
 * path at all. Code and data are separate (00-context.md:84-89): on a normal
 * install `beyin` is on PATH; the two overrides exist for development.
 */
export function commandFor(env: Record<string, string | undefined>): { file: string; prefix: string[] } {
  const cli = (env.BEYIN_CLI ?? "").trim();
  if (cli) return { file: process.execPath, prefix: [cli] };
  const root = (env.BEYIN_PACKAGE_ROOT ?? "").trim();
  if (root) return { file: process.execPath, prefix: [join(root, "bin", "beyin.js")] };
  return { file: "beyin", prefix: [] };
}

/** The project the block is tagged with: a name, never a host path. */
export function projectOf(cwd: string): string | undefined {
  if (!cwd) return undefined;
  const name = basename(cwd);
  return name && name !== "/" ? name : undefined;
}

/**
 * `beyin context` for one cwd, as bytes. Resolves to "" on any failure: a
 * missing CLI, a non-zero exit or a timeout means no injection, not an error.
 */
export function contextBlock(cwd: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  const { file, prefix } = commandFor(env);
  const args = [...prefix, "context"];
  const project = projectOf(cwd);
  if (project !== undefined) args.push("--project", project);
  return new Promise((done) => {
    execFile(file, args, { env, timeout: CONTEXT_TIMEOUT_MS, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) {
        done("");
        return;
      }
      done(String(stdout ?? "").trim());
    });
  });
}

/** One shell word, quoted, so a path with a space cannot split the knock. */
function quote(word: string): string {
  return "'" + word.replace(/'/g, "'\\''") + "'";
}

/**
 * The session-start knock (04 section 6): ingest, then the finished-session
 * sweep. One detached shell runs the pair, so the sweep sees what the ingest
 * just normalized and the hook itself never waits. The chain is chained inside
 * the child rather than in the extension: a detached, unref'd child may outlive
 * this process, and a promise that waits on it would never settle.
 *
 * If pi exits before the knock finishes the pair finishes anyway; if it never
 * started, the next session_start knocks again and the sweep is keyed by
 * digest, so a missed knock costs one session of latency, never a duplicate.
 */
export function knock(env: Record<string, string | undefined> = process.env): void {
  const { file, prefix } = commandFor(env);
  const beyin = (args: string[]) => [file, ...prefix, ...args].map(quote).join(" ");
  const line = beyin(["ingest", "--all"]) + " && " + beyin(["dream", "--once"]);
  try {
    // No cwd: the vault is resolved from the environment, not from where pi was
    // started, and a cwd that has since been deleted must not eat the knock.
    const child = spawn("/bin/sh", ["-c", line], { detached: true, stdio: "ignore", env });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Fail open (AGENTS.md principle 9): a knock that cannot start is not a
    // reason to break the session that just started.
  }
}

export default function beyinPi(pi: PiExtensionApi): void {
  // One variable, per 04 section 5: the cwd the block was emitted for. It is
  // the per-session flag the brief asks for, and it makes the open question in
  // 04 section 11 (does before_agent_start fire once per prompt or once per
  // tool round?) harmless: a second call in the same cwd injects nothing.
  let emittedFor: string | null = null;

  // session_start cannot inject on pi (04 section 5); it resets the flag for
  // every start reason (startup, reload, new, resume, fork) and knocks.
  pi.on("session_start", async (_event: any, ctx: any) => {
    emittedFor = null;
    knock();
  });

  pi.on("before_agent_start", async (_event: any, ctx: any) => {
    const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : "";
    if (!cwd) return;
    if (emittedFor === cwd) return;
    // Marked before the await, so two prompts that overlap cannot both inject.
    emittedFor = cwd;
    const text = await contextBlock(cwd);
    if (!text) return;
    return { message: { customType: "beyin-context", content: text, display: false } };
  });
}
