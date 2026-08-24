const ANSI_COLORS = {
  cyan: "\u001B[36m",
  green: "\u001B[32m",
  red: "\u001B[31m",
  reset: "\u001B[0m",
  yellow: "\u001B[33m",
} as const;

export interface TerminalOutput {
  error: (message: string) => void;
  info: (message: string) => void;
  plain: (message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
}

export function createTerminalOutput(
  stdout: (message: string) => void,
  stderr: (message: string) => void,
  colorEnabled: boolean,
): TerminalOutput {
  // 颜色只修饰固定标签，正文保持可复制，关闭颜色时不残留 ANSI 控制符。
  const label = (text: string, color: string): string =>
    colorEnabled ? `${color}[${text}]${ANSI_COLORS.reset}` : `[${text}]`;

  return {
    error: (message) => {
      stderr(`${label("错误", ANSI_COLORS.red)} ${message}\n`);
    },
    info: (message) => {
      stdout(`${label("信息", ANSI_COLORS.cyan)} ${message}\n`);
    },
    plain: stdout,
    success: (message) => {
      stdout(`${label("成功", ANSI_COLORS.green)} ${message}\n`);
    },
    warning: (message) => {
      stderr(`${label("警告", ANSI_COLORS.yellow)} ${message}\n`);
    },
  };
}
