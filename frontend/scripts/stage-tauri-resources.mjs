// Tauri 打包资源装配：把自包含 sidecar + FFmpeg 内嵌到 src-tauri/staged/，
// tauri.conf.json 的 "resources": { "staged/*": "" } 会将其打进安装包。
// 用法：npm run stage:resources（CI Windows 作业 / 本地 Windows 打包前执行）。
// 失败即 loud fail：缺 dotnet、发布失败、找不到 FFmpeg 都直接 exit 1。
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(scriptsDir, "..");
const repoRoot = join(scriptsDir, "..", "..");
const staged = join(frontendRoot, "src-tauri", "staged");
const serverDir = join(staged, "server");
const ffmpegDir = join(staged, "ffmpeg");

function run(cmd, args, opts = {}) {
  console.log(`[stage] ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    console.error(`[stage] FAILED (${result.status}): ${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function findOnPath(name) {
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(sep)) {
    for (const suffix of suffixes) {
      const candidate = join(dir, name + suffix);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// 0. 清理并重建 staged 目录。
rmSync(staged, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
mkdirSync(serverDir, { recursive: true });
mkdirSync(ffmpegDir, { recursive: true });

// 1. 发布自包含 sidecar（win-x64 单文件，无需目标机装 .NET）。
run("dotnet", [
  "publish",
  join(repoRoot, "src", "Radar.Server", "Radar.Server.csproj"),
  "-c", "Release",
  "-r", "win-x64",
  "--self-contained", "true",
  "-o", serverDir,
]);
const serverExe = join(serverDir, "CSStatsRadar.Server.exe");
if (!existsSync(serverExe)) {
  console.error(`[stage] server binary missing after publish: ${serverExe}`);
  process.exit(1);
}

// 2. FFmpeg 内嵌：显式路径优先，否则 PATH 查找；一律 --version 验活。
// 注意解引用符号链接（brew/choco 常见），安装包内必须是实体文件。
const ffmpegEnv = process.env.CS_RADAR_FFMPEG_EXE?.trim();
const ffmpegFound = ffmpegEnv || findOnPath("ffmpeg");
if (!ffmpegFound || !existsSync(ffmpegFound)) {
  console.error(
    "[stage] ffmpeg not found. Set CS_RADAR_FFMPEG_EXE or install ffmpeg " +
    "(CI: choco install ffmpeg).",
  );
  process.exit(1);
}
const ffmpegSrc = realpathSync(ffmpegFound);
run(ffmpegSrc, ["-version"], { stdio: "pipe" });
const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
cpSync(ffmpegSrc, join(ffmpegDir, ffmpegName));
console.log(`[stage] ffmpeg: ${ffmpegSrc} -> staged/ffmpeg/${ffmpegName}`);

// 3. 版本标记（运行时自检与问题定位用）。
const pkgVersion = JSON.parse(readFileSync(join(frontendRoot, "package.json"), "utf8")).version;
writeFileSync(join(staged, "release_version.txt"), `${pkgVersion}\n`);

console.log(`[stage] staged Tauri resources at ${staged}`);
