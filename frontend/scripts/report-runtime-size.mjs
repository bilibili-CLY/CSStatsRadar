// 打包体积预算：统计 src-tauri/staged + frontend/dist，超预算直接失败。
// 用法：npm run report:size
// 预算：CS_RADAR_SIZE_BUDGET_MB（默认 400，含自包含 .NET sidecar + FFmpeg 全量版）。
// 注意：NSIS 压缩后安装包通常只有 staged 的约 40%。
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(scriptsDir, "..");
const budgetMb = Number(process.env.CS_RADAR_SIZE_BUDGET_MB ?? 400);

function dirSize(path) {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

const staged = join(frontendRoot, "src-tauri", "staged");
const dist = join(frontendRoot, "dist");
const stagedMb = dirSize(staged) / 1024 / 1024;
const distMb = dirSize(dist) / 1024 / 1024;
const totalMb = stagedMb + distMb;

console.log(`[size] staged/: ${stagedMb.toFixed(1)} MiB`);
console.log(`[size] dist/: ${distMb.toFixed(1)} MiB`);
console.log(`[size] total: ${totalMb.toFixed(1)} MiB (budget ${budgetMb} MiB)`);

if (totalMb > budgetMb) {
  console.error("[size] OVER BUDGET");
  process.exit(1);
}
console.log("[size] within budget");
