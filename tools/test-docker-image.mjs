import { execFileSync } from "node:child_process";

const image = process.env["CODEXLY_DOCKER_IMAGE"] ?? "codexly:local";
const container = `codexly-smoke-${String(process.pid)}`;
const composeWorkspace = "/srv/codexly-projects";
const gitConfigPath = "/tmp/codexly-gitconfig";
const sshHomePath = "/tmp/codexly-ssh";

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

function verifyComposeWorkspaceMapping() {
  const readConfig = (environment) =>
    JSON.parse(
      execFileSync("docker", ["compose", "config", "--format", "json"], {
        encoding: "utf8",
        env: { ...process.env, ...environment },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  const config = readConfig({ CODEXLY_WORKSPACE: composeWorkspace });
  const service = config.services?.codexly;
  const workspaceMount = service?.volumes?.find((mount) => mount.source === composeWorkspace);

  // POSIX 宿主与容器路径必须一致，否则复用 Codex Home 后的项目路径会失效。
  if (
    service?.environment?.CODEXLY_WORKSPACE !== composeWorkspace ||
    workspaceMount?.target !== composeWorkspace
  ) {
    throw new Error("Compose does not preserve the configured workspace path");
  }

  const windowsConfig = readConfig({
    CODEXLY_WORKSPACE: "C:/",
    CODEXLY_WORKSPACE_TARGET: "/workspace",
  });
  const windowsService = windowsConfig.services?.codexly;
  const windowsMount = windowsService?.volumes?.find((mount) => mount.source === "C:/");

  // Windows 源路径不能直接作为 Linux 容器目标，必须允许显式覆盖。
  if (
    windowsService?.environment?.CODEXLY_WORKSPACE !== "/workspace" ||
    windowsMount?.target !== "/workspace"
  ) {
    throw new Error("Compose does not apply the configured container workspace path");
  }

  const gitConfig = readConfig({ CODEXLY_GIT_CONFIG: gitConfigPath });
  if (gitConfig.services?.codexly?.environment?.CODEXLY_GIT_CONFIG !== gitConfigPath) {
    throw new Error("Compose does not expose the configured global Git config path");
  }

  const sshConfig = readConfig({ CODEXLY_SSH_HOME: sshHomePath });
  const sshMount = sshConfig.services?.codexly?.volumes?.find(
    (mount) => mount.source === sshHomePath,
  );
  if (sshMount?.target !== "/home/node/.ssh" || sshMount?.read_only !== true) {
    throw new Error("Compose does not mount the configured SSH home read-only");
  }
}

try {
  verifyComposeWorkspaceMapping();
  // 保留失败容器直到读取日志，确保启动错误不会被 --rm 丢失。
  docker(["run", "--detach", "--name", container, image]);
  // Git SSH 远程依赖运行镜像提供 ssh 客户端，否则 push 会在 fork 前失败。
  docker(["exec", container, "ssh", "-V"]);
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
