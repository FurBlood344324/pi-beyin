/**
 * Test helpers: temp directory, fixture copy and extension path.
 *
 * Tests do NOT modify the repo's fixture files; every run uses its own temp
 * directory. That keeps tests independent of the user's `~/.config/beyin` state
 * and of the repo working tree.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function tmpDir(prefix = "pi-beyin-test-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Extension file under test; `query` busts Bun's module cache.
 *
 * Note: an absolute path is used — Bun ignores the query string on `file://` URLs,
 * so `?fresh=` cache-busting silently does nothing (measured: the same module instance comes back).
 */
export function extensionUrl(name: "context" | "damitma" | "jev", query = ""): string {
	const file = path.join(HERE, "..", "extensions", `${name}.ts`);
	return query ? `${file}?${query}` : file;
}
