import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distPath = path.join(root, "dist", "tweet-discord-share.user.js");
const before = fs.existsSync(distPath) ? fs.readFileSync(distPath, "utf8") : null;
const normalizeLineEndings = (value) => value?.replace(/\r\n/g, "\n");
const result = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs")], {
  cwd: root,
  stdio: "inherit"
});

if (result.status !== 0) process.exit(result.status ?? 1);

const after = fs.readFileSync(distPath, "utf8");
if (normalizeLineEndings(before) !== normalizeLineEndings(after)) {
  console.error("dist/tweet-discord-share.user.js was stale and has been regenerated. Review and commit it.");
  process.exit(1);
}

console.log("Generated userscript matches source and package version.");
