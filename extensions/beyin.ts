/**
 * beyin on pi: the thin adapter (docs/design/04-adapters.md sections 4-6 and 8).
 *
 * Two seams and five thin tools. The tools are native calls (like bash or
 * write) that run the `beyin` CLI and return its JSON; the CLI owns every
 * rule, the adapter only maps arguments to flags. Descriptions are one line
 * each so the per-request definition cost stays small.
 *
 *   session_start      knock: `beyin ingest --all`, then `beyin dream --once`, detached
 *   before_agent_start inject `beyin context` once per session, again on a cwd change
 *   tools              beyin_recall, beyin_note, beyin_correct, beyin_receipt, beyin_task
 *
 * Nothing here formats the block: the CLI owns the bytes and the 4,900 B
 * budget (src/context.js:23), so both harnesses print the same text. Every
 * failure is swallowed (AGENTS.md principle 9): a broken adapter must not break
 * the session, and an empty vault must inject nothing rather than a frame.
 */
import { execFile, spawn } from "node:child_process";
import { basename, join } from "node:path";

const CONTEXT_TIMEOUT_MS = 3000;
const TOOL_TIMEOUT_MS = 20000;

export interface PiExtensionApi {
  on(event: string, handler: (event: any, ctx: any) => any): unknown;
  registerTool?(definition: any): unknown;
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


type ToolSpec = {
  name: string;
  verb: string;
  description: string;
  required: string[];
  /** parameter -> JSON-schema fragment; string[] params repeat the flag. */
  props: Record<string, Record<string, unknown>>;
};

const str = (description: string) => ({ type: "string", description });
const list = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const TOOLS: ToolSpec[] = [
  {
    name: "beyin_recall",
    verb: "recall",
    description: "Search past sessions in the second brain (BM25 transcript hits as JSON).",
    required: ["query"],
    props: {
      query: str("search text"),
      limit: { type: "number", description: "max hits (default 7)" },
      harness: str("dsh | claude | pi"),
      project: str("project name"),
      kind: str("page | event"),
    },
  },
  {
    name: "beyin_note",
    verb: "note",
    description: "Write a lasting fact, decision or method to the vault.",
    required: ["title", "domain", "body"],
    props: {
      title: str("note title"),
      domain: str("an existing notes/ domain"),
      body: str("the fact"),
      confidence: str("checked (verified against a source) | unconfirmed"),
      project: str("project name"),
      source: list("source paths"),
      link: list("linked note slugs"),
    },
  },
  {
    name: "beyin_correct",
    verb: "correct",
    description: "Record an operator correction as a one-line rule.",
    required: ["text"],
    props: { text: str("one-line rule"), source: str("default operator"), date: str("YYYY-MM-DD"), project: str("project name") },
  },
  {
    name: "beyin_receipt",
    verb: "receipt",
    description: "Record a receipt for finished work; refs are the files it touched.",
    required: ["summary", "refs"],
    props: {
      summary: str("what finished"),
      refs: list("files the work touched"),
      project: str("project name"),
      session: str("session id"),
      source: list("source paths"),
    },
  },
  {
    name: "beyin_task",
    verb: "task",
    description: "Create or update a task with one concrete next step (a second call appends).",
    required: ["slug", "body"],
    props: {
      slug: str("task slug"),
      body: str("one concrete next step"),
      status: str("default open"),
      next: str("what unblocks it"),
      project: str("project name"),
      source: list("source paths"),
    },
  },
];

/** Parameters -> argv. `query` is positional; arrays repeat their flag; unknown keys are ignored. */
export function argsFor(spec: ToolSpec, params: Record<string, unknown>): string[] {
  const args: string[] = [spec.verb];
  for (const key of Object.keys(spec.props)) {
    const value = params?.[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "query") {
      args.push(String(value));
      continue;
    }
    for (const one of Array.isArray(value) ? value : [value]) args.push("--" + key, String(one));
  }
  return args;
}

/** Runs one CLI verb. Never throws: a failure is a text result the model can read. */
export function runTool(
  spec: ToolSpec,
  params: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  const missing = spec.required.filter((key) => {
    const value = params?.[key];
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  });
  const reply = (text: string, ok: boolean) => ({ content: [{ type: "text" as const, text }], details: { ok } });
  if (missing.length) return Promise.resolve(reply("missing: " + missing.join(", "), false));
  const { file, prefix } = commandFor(env);
  return new Promise((done) => {
    execFile(
      file,
      [...prefix, ...argsFor(spec, params)],
      { env, timeout: TOOL_TIMEOUT_MS, maxBuffer: 1 << 20 },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "").trim();
        if (error) {
          done(reply((String(stderr ?? "").trim() || out || String(error.message)).slice(0, 4000), false));
          return;
        }
        done(reply(out || "ok", true));
      },
    );
  });
}

function registerTools(pi: PiExtensionApi): void {
  if (typeof pi.registerTool !== "function") return;
  for (const spec of TOOLS) {
    try {
      pi.registerTool({
        name: spec.name,
        label: spec.name,
        description: spec.description,
        parameters: { type: "object", properties: spec.props, required: spec.required },
        async execute(_id: string, params: Record<string, unknown>) {
          return runTool(spec, params);
        },
      });
    } catch {
      // Fail open: a tool that cannot register must not break the session.
    }
  }
}

export default function beyinPi(pi: PiExtensionApi): void {
  registerTools(pi);
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
