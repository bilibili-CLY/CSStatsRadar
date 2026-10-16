// 跨平台环境变量注入：node scripts/with-sidecar-env.mjs -- <cmd> [args...]
// 把 VITE_CS_RADAR_URL 指向固定 sidecar 地址（除非调用方已显式设置），
// 替代 cross-env（零依赖，Windows cmd 下同样可用）。
// 用法见 package.json 的 desktop:dev / desktop:build。
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const cmd = dash === -1 ? argv : argv.slice(dash + 1);
if (cmd.length === 0) {
  console.error("usage: node scripts/with-sidecar-env.mjs -- <cmd> [args...]");
  process.exit(2);
}

const env = { ...process.env };
env.VITE_CS_RADAR_URL ??= "http://127.0.0.1:19871";

const result = spawnSync(cmd[0], cmd.slice(1), {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});
process.exit(result.status ?? 1);
