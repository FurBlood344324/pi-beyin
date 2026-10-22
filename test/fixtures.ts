/**
 * Test yardımcıları: geçici dizin, fixture kopyası ve extension yolu.
 *
 * Testler repodaki fixture dosyalarını **değiştirmez**; her koşum kendi geçici
 * dizininde çalışır. Böylece testler kullanıcının `~/.config/beyin` durumuna ve
 * repo çalışma ağacına bağımlı olmaz.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function tmpDir(prefix = "pi-beyin-test-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Repodaki bir fixture'ı geçici dizine kopyalar ve kopyanın yolunu döndürür. */
export function fixture(name: string, dir: string): string {
	const dest = path.join(dir, name);
	fs.copyFileSync(path.join(HERE, name), dest);
	return dest;
}

/** Test edilecek extension dosyası; `query` ile Bun modül önbelleği tazelenir.
 *
 * Dikkat: mutlak yol kullanılır — `file://` URL'lerinde Bun sorgu dizesini yok sayar
 * ve `?fresh=` cache-bust sessizce çalışmaz (ölçüldü: aynı modül örneği döner).
 */
export function extensionUrl(name: "context" | "damitma" | "jev", query = ""): string {
	const file = path.join(HERE, "..", "extensions", `${name}.ts`);
	return query ? `${file}?${query}` : file;
}
