import { execFileSync } from "node:child_process";

const image = process.env["CODEXLY_DOCKER_IMAGE"] ?? "codexly:local";
const container = `codexly-smoke-${String(process.pid)}`;

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

try {
  // 保留失败容器直到读取日志，确保启动错误不会被 --rm 丢失。
  docker(["run", "--detach", "--name", container, image]);
  const deadline = Date.now() + 90_000;

  // 镜像内健康检查覆盖 Codex 子进程、SQLite 初始化与 HTTP 服务启动。
  while (Date.now() < deadline) {
    const state = JSON.parse(docker(["inspect", "--format", "{{json .State}}", container]));
    if (state.Status === "exited" || state.Status === "dead") {
      throw new Error(`Container exited before becoming healthy (code ${String(state.ExitCode)})`);
    }
    if (state.Health?.Status === "healthy") {
      process.stdout.write(`Docker image verified: ${image}\n`);
      process.exitCode = 0;
      break;
    }
    await wait(1_000);
  }

  if (process.exitCode === undefined) {
    throw new Error("Container did not become healthy within 90 seconds");
  }
} catch (error) {
  try {
    execFileSync("docker", ["logs", container], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch {
    // 容器创建失败时保留原始错误。
  }
  throw error;
} finally {
  try {
    docker(["rm", "--force", container]);
  } catch {
    // 容器创建失败时无需清理。
  }
}
