import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const scriptPath = fileURLToPath(new URL("../benchmarks/terminal/windows-resources.ps1", import.meta.url));

void test("Windows resource sampling excludes stale parent PIDs and their descendants", {
  skip: process.platform !== "win32",
}, async () => {
  const script = `
$ErrorActionPreference = 'Stop'
$fixtureProcesses = @(
  @{ProcessId=10;ParentProcessId=1;CreationDate=[datetime]'2026-10-14T11:00:00Z'},
  @{ProcessId=20;ParentProcessId=10;CreationDate=[datetime]'2026-10-14T11:01:00Z'},
  @{ProcessId=30;ParentProcessId=20;CreationDate=[datetime]'2026-10-14T10:00:00Z'},
  @{ProcessId=40;ParentProcessId=20;CreationDate=[datetime]'2026-10-14T11:02:00Z'},
  @{ProcessId=50;ParentProcessId=40;CreationDate=[datetime]'2026-10-14T11:03:00Z'},
  @{ProcessId=60;ParentProcessId=30;CreationDate=[datetime]'2026-10-14T10:01:00Z'}
)
function Get-CimInstance {
  param([string]$ClassName, [string[]]$Property)
  $fixtureProcesses
}
function Get-Process {
  [CmdletBinding()] param([int]$Id)
  $row = $fixtureProcesses | Where-Object { $_.ProcessId -eq $Id }
  if ($null -eq $row) { return }
  [pscustomobject]@{
    Id=$Id;StartTime=$row.CreationDate;WorkingSet64=2048;PrivateMemorySize64=1024
    TotalProcessorTime=[timespan]::FromSeconds(1)
  }
}
& '${scriptPath.replace(/'/g, "''")}' -AppProcessId 10 -ShellProcessIds 20
`;
  const result = await execute("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ], { windowsHide: true, encoding: "utf8" });
  const processes = JSON.parse(result.stdout);
  assert.deepEqual(processes.map((row) => row.pid).sort((a, b) => a - b), [10, 20, 40, 50]);
  assert.equal(processes.find((row) => row.pid === 10).group, "app");
  assert.equal(processes.find((row) => row.pid === 20).group, "shell");
  assert.equal(processes.find((row) => row.pid === 50).group, "descendant");
});
