import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, isAbsolute } from "node:path";
import { homedir } from "node:os";
export interface AgentCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}
/** 不运行 --version 或登录命令；仅检查可信 PATH 和标准用户安装目录的可执行文件。 */
export async function findAgentExecutable(
  name: string,
  environment = process.env,
): Promise<string | undefined> {
  const directories = [
    ...(environment["PATH"] ?? "").split(delimiter).filter(isAbsolute),
    join(homedir(), ".local", "bin"),
    join(homedir(), ".npm-global", "bin"),
  ];
  if (process.platform === "win32" && environment["APPDATA"])
    directories.push(join(environment["APPDATA"], "npm"));
  const extensions =
    process.platform === "win32" ? (environment["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of new Set(directories))
    for (const extension of extensions) {
      const path = join(directory, name + extension.toLowerCase());
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return path;
      } catch {
        /* 下一个候选，不把目录存在误报为已安装。 */
      }
    }
}
