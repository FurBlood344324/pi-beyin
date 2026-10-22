import { extensionUrl } from "./fixtures.ts";

const damitma = await import(extensionUrl("damitma"));
const context = await import(extensionUrl("context"));
const jev = await import(extensionUrl("jev"));
console.log("import ok:", typeof damitma.default, typeof context.default, typeof jev.default);
