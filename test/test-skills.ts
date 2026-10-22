/**
 * Package-level skill checks. No vault, no model calls.
 *
 * Guards the mistakes that are easy to make when skills are shipped as files:
 * a directory whose name disagrees with `name:`, a description that quietly
 * grows (every description sits in the system prompt on every turn), personal
 * paths leaking into a public package, or a `pi.skills` manifest that is not
 * declared at all (pi then loads no package skills).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { check, section, summary } from "./harness.ts";

const ROOT = path.join(import.meta.dir, "..");
const SKILLS = path.join(ROOT, "skills");
// Every description is in the system prompt on every turn; keep the total in budget.
const MAX_DESCRIPTION = 600;
const MAX_TOTAL = 3200;

const dirs = fs
	.readdirSync(SKILLS, { withFileTypes: true })
	.filter((d) => d.isDirectory() && !d.name.startsWith("_"))
	.map((d) => d.name)
	.sort();

section("inventory");
check("at least eight skills ship", dirs.length >= 8, dirs.length);
check(
	"no Turkish-only directory names",
	dirs.every((d) => /^[a-z][a-z0-9-]*$/.test(d)),
	dirs.join(","),
);

section("frontmatter");
let total = 0;
for (const dir of dirs) {
	const file = path.join(SKILLS, dir, "SKILL.md");
	const exists = fs.existsSync(file);
	check(`${dir}: SKILL.md exists`, exists);
	if (!exists) continue;
	const text = fs.readFileSync(file, "utf8");
	const name = /^name: (.+)$/m.exec(text)?.[1]?.trim() ?? "";
	const description = /^description: (.+)$/m.exec(text)?.[1]?.trim() ?? "";
	check(`${dir}: name matches the directory`, name === dir, name);
	check(`${dir}: has a description`, description.length > 0);
	check(
		`${dir}: description within ${MAX_DESCRIPTION} chars`,
		description.length <= MAX_DESCRIPTION,
		description.length,
	);
	// Routing stays bilingual: the author speaks Turkish, so a description must keep at
	// least one Turkish trigger phrase (diacritics or a common Turkish token).
	const TR_TRIGGER = /"[^"]*(?:[çğışöüÇĞİŞÖÜ]|\b(?:deney|günlük|hatırla|damıt|temizlik|sistemi|makale|kaydet|oturumu|sürüm|hafıza|arşiv|beyin|doktor|güncelle)\b)[^"]*"/;
	check(`${dir}: keeps Turkish triggers`, TR_TRIGGER.test(description));
	total += description.length;

	section(`${dir}: content hygiene`);
	check(`${dir}: no personal paths`, !/\/home\/(?!user\b)[a-z]|projects\/work\b|furblood/i.test(text));
	const sharedRefs = [...text.matchAll(/\.\.\/_shared\/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
	check(
		`${dir}: shared references resolve`,
		sharedRefs.every((ref) => fs.existsSync(path.join(SKILLS, "_shared", ref))),
		sharedRefs.join(",") || "none",
	);
}

section("budget");
check(`total description size <= ${MAX_TOTAL}`, total <= MAX_TOTAL, total);

section("manifest");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const declared = (pkg.pi?.skills ?? []).map((p: string) => p.replace(/^\.\//, "").replace(/\/$/, ""));
check("pi.skills declares the skills directory", declared.includes("skills"), declared.join(","));
check("package files include skills", (pkg.files ?? []).includes("skills"));
check("shared schema document exists", fs.existsSync(path.join(SKILLS, "_shared", "project-profile.md")));

summary();
