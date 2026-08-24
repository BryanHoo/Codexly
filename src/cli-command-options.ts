export interface ParsedCommandOptions {
  allowedHosts?: string[];
  codexBin?: string;
  codexHome?: string;
  lan?: boolean;
  lanPassword?: string;
  port?: number;
  sessionTtl?: string;
}

export const CLI_HELP = `Usage: codexly [command] [options]

Commands:
  start    Start the Codexly server and open the Web interface.
  doctor   Check whether the local Codexly runtime is ready.
  version  Print the installed Codexly version.

Start options:
  --port <port>              Start from the specified TCP port. Defaults to 3210.
                             Automatically increases the port when it is occupied.
  --lan                      Listen on all network interfaces for trusted LAN access.
                             This disables automatic browser opening.
  --lan-password <password>  Use a custom strong LAN access password instead of a random one.
                             Requires 16-128 characters and all character types. Requires --lan.
  --allowed-host <domain>    Allow an exact reverse proxy domain. May be repeated.
  --session-ttl <duration>   Set the fixed LAN session lifetime using ms, s, m, h, or d.
                             Sessions do not expire when omitted. Requires --lan.
  --codex-bin <path>         Use the Codex executable at the specified path.
  --codex-home <path>        Use a custom Codex home directory instead of CODEX_HOME
                             or the default ~/.codex directory.

Doctor options:
  --codex-bin <path>         Check the Codex executable at the specified path.
  --codex-home <path>        Check the state database in the specified Codex home.

Global options:
  -h, --help                 Display all commands, options, and usage details.

Examples:
  codexly
  codexly start --port 4567
  codexly start --lan --lan-password 'Strong-Lan_Pass9!'
  codexly start --allowed-host code.example.com
  codexly start --lan --session-ttl 12h
  codexly doctor --codex-bin /path/to/codex
  codexly version

Running codexly without a command is equivalent to codexly start.
`;

export function parseCommandOptions(
  args: readonly string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string> = new Set(),
): ParsedCommandOptions {
  const parsed: ParsedCommandOptions = {};
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option || (!valueOptions.has(option) && !flagOptions.has(option))) {
      throw new Error(`未知选项: ${option ?? "<empty>"}`);
    }
    const repeatable = option === "--allowed-host";
    if (seen.has(option) && !repeatable) {
      throw new Error(`选项重复: ${option}`);
    }
    seen.add(option);
    if (flagOptions.has(option)) {
      if (option === "--lan") {
        parsed.lan = true;
      }
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`选项缺少值: ${option}`);
    }

    if (option === "--codex-bin") {
      parsed.codexBin = value;
    } else if (option === "--codex-home") {
      parsed.codexHome = value;
    } else if (option === "--lan-password") {
      parsed.lanPassword = value;
    } else if (option === "--allowed-host") {
      parsed.allowedHosts = [...(parsed.allowedHosts ?? []), value];
    } else if (option === "--port") {
      if (!/^\d+$/u.test(value)) {
        throw new Error("--port 必须是 1 到 65535 之间的整数");
      }
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("--port 必须是 1 到 65535 之间的整数");
      }
      parsed.port = port;
    } else if (option === "--session-ttl") {
      parsed.sessionTtl = value;
    }
    index += 1;
  }

  return parsed;
}
