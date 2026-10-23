import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUserscript } from "./userscript-bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, "dist", "tweet-discord-share.user.js");

let built;
try {
  built = buildUserscript();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, built.source, "utf8");

console.log(`Built ${outPath} (${built.moduleCount} modules)`);
