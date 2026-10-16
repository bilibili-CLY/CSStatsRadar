// 版本一致性门禁：frontend/package.json、src-tauri/Cargo.toml、
// src/Radar.Server/Radar.Server.csproj 三处版本必须相同。
// 用法：npm run stamp:versions（CI desktop 流程中强制执行）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(scriptsDir, "..");
const repoRoot = join(scriptsDir, "..", "..");

const failures = [];

const pkg = JSON.parse(readFileSync(join(frontendRoot, "package.json"), "utf8"));
const pkgVersion = pkg.version?.trim();
console.log(`[stamp] frontend/package.json: ${pkgVersion}`);

const cargo = readFileSync(join(frontendRoot, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]?.trim();
console.log(`[stamp] src-tauri/Cargo.toml: ${cargoVersion}`);
if (cargoVersion !== pkgVersion)
  failures.push(`Cargo.toml (${cargoVersion}) != package.json (${pkgVersion})`);

const csproj = readFileSync(
  join(repoRoot, "src", "Radar.Server", "Radar.Server.csproj"),
  "utf8",
);
const csprojVersion = csproj.match(/<Version>([^<]+)<\/Version>/)?.[1]?.trim();
console.log(`[stamp] Radar.Server.csproj: ${csprojVersion}`);
if (csprojVersion !== pkgVersion)
  failures.push(`Radar.Server.csproj (${csprojVersion}) != package.json (${pkgVersion})`);

if (failures.length > 0) {
  for (const f of failures) console.error(`[stamp] MISMATCH: ${f}`);
  process.exit(1);
}
console.log("[stamp] versions aligned");
