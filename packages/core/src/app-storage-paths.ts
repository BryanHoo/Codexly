import { homedir } from "node:os";
import { join, resolve, win32, posix } from "node:path";

/** 应用数据与引擎配置分离；CODEX_HOME 仅用于发现旧数据，不再改变新目录。 */
export function appStorageDirectory(home = homedir()): string {
  return join(home, ".codexly");
}

function nonempty(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

export function legacyStorageDirectories(
  codexHome: string,
  home = homedir(),
  platform: string = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const path = platform === "win32" ? win32 : posix;
  const desktop =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "com.codexly.desktop")
      : platform === "win32"
        ? path.join(
            nonempty(environment["APPDATA"]) ?? path.join(home, "AppData", "Roaming"),
            "com.codexly.desktop",
          )
        : path.join(
            nonempty(environment["XDG_DATA_HOME"]) ?? path.join(home, ".local", "share"),
            "com.codexly.desktop",
          );
  return [
    ...new Set([path.resolve(codexHome, "codexly"), path.join(home, ".codex", "codexly"), desktop]),
  ];
}

export function defaultCodexHome(): string {
  return resolve(nonempty(process.env["CODEX_HOME"]) ?? join(homedir(), ".codex"));
}
