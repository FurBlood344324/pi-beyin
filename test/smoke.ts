import { extensionUrl } from "./fixtures.ts";

const beyin = await import(extensionUrl("beyin"));
const batch = await import(extensionUrl("batch"));
console.log("import ok:", typeof beyin.default, typeof batch.default);
if (typeof beyin.default !== "function" || typeof batch.default !== "function") process.exit(1);
