import { extensionUrl } from "./fixtures.ts";

const distillation = await import(extensionUrl("distillation"));
const context = await import(extensionUrl("context"));
const jev = await import(extensionUrl("jev"));
const compact = await import(extensionUrl("compact"));
console.log(
	"import ok:",
	typeof distillation.default,
	typeof context.default,
	typeof jev.default,
	typeof compact.default,
);
