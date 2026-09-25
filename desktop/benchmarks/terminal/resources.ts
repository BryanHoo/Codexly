import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
type ProcessSample = { pid: number; startTicks: string; rssKiB: number; privateKiB: number; cpuSeconds: number; group: "app" | "shell" | "descendant" };
export type ResourceSample = { elapsedMs: number; appRssKiB: number; shellRssKiB: number; appCpuSeconds: number; shellCpuSeconds: number; treeRssKiB?: number; treePrivateKiB?: number; processes?: ProcessSample[] };

function cpuSeconds(value: string): number {
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

export async function sampleResources(appPid: number, shellPids: number[], started: number): Promise<ResourceSample> {
  if (![appPid, ...shellPids].every((pid) => Number.isSafeInteger(pid) && pid > 0)) throw new Error("Invalid benchmark PID");
  if (process.platform === "win32") {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./windows-resources.ps1", import.meta.url)), "-AppProcessId", String(appPid), "-ShellProcessIds", shellPids.join(",")], { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 });
    const processes = JSON.parse(stdout) as ProcessSample[];
    const sum = (group: "app" | "shell", field: "rssKiB" | "cpuSeconds") => processes.filter((row) => row.group === group).reduce((total, row) => total + row[field], 0);
    return { elapsedMs: performance.now() - started, appRssKiB: sum("app", "rssKiB"), shellRssKiB: sum("shell", "rssKiB"), appCpuSeconds: sum("app", "cpuSeconds"), shellCpuSeconds: sum("shell", "cpuSeconds"), treeRssKiB: processes.reduce((total, row) => total + row.rssKiB, 0), treePrivateKiB: processes.reduce((total, row) => total + row.privateKiB, 0), processes };
  }
  const { stdout } = await run("/bin/ps", ["-p", [appPid, ...shellPids].join(","), "-o", "pid=,rss=,time="], { maxBuffer: 16384 });
  const sample: ResourceSample = { elapsedMs: performance.now() - started, appRssKiB: 0, shellRssKiB: 0, appCpuSeconds: 0, shellCpuSeconds: 0 };
  // 仅查询已知测试进程的数值字段，不读取 args、comm 或环境变量。
  for (const row of stdout.trim().split("\n")) {
    const [pid, rss, time] = row.trim().split(/\s+/);
    if (Number(pid) === appPid) { sample.appRssKiB = Number(rss); sample.appCpuSeconds = cpuSeconds(time!); }
    else { sample.shellRssKiB += Number(rss); sample.shellCpuSeconds += cpuSeconds(time!); }
  }
  return sample;
}

export function summarizeResources(samples: ResourceSample[]) {
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const identities = new Map<string, { first: number; last: number }>();
  samples.forEach((sample, index) => sample.processes?.forEach((row) => {
    const key = `${row.pid}:${row.startTicks}`;
    const previous = identities.get(key);
    identities.set(key, { first: previous?.first ?? (index === 0 ? row.cpuSeconds : 0), last: row.cpuSeconds });
  }));
  return {
    appCpuPercent: (last.appCpuSeconds - first.appCpuSeconds) / ((last.elapsedMs - first.elapsedMs) / 1000) * 100,
    shellCpuPercent: (last.shellCpuSeconds - first.shellCpuSeconds) / ((last.elapsedMs - first.elapsedMs) / 1000) * 100,
    appRssKiB: { first: first.appRssKiB, last: last.appRssKiB, max: Math.max(...samples.map((sample) => sample.appRssKiB)) },
    shellRssKiB: { first: first.shellRssKiB, last: last.shellRssKiB, max: Math.max(...samples.map((sample) => sample.shellRssKiB)) },
    ...(first.treeRssKiB === undefined ? {} : {
      treeCpuPercent: [...identities.values()].reduce((total, row) => total + Math.max(0, row.last - row.first), 0) / ((last.elapsedMs - first.elapsedMs) / 1000) * 100,
      treeRssKiB: { first: first.treeRssKiB, last: last.treeRssKiB, max: Math.max(...samples.map((sample) => sample.treeRssKiB ?? 0)) },
      treePrivateKiB: { first: first.treePrivateKiB, last: last.treePrivateKiB, max: Math.max(...samples.map((sample) => sample.treePrivateKiB ?? 0)) },
    }),
  };
}
