param([Parameter(Mandatory = $true)][int]$AppProcessId, [string]$ShellProcessIds = '')
$ErrorActionPreference = 'Stop'
$shellIds = @($ShellProcessIds.Split(',') | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })
$owned = New-Object 'System.Collections.Generic.HashSet[int]'
$null = $owned.Add($AppProcessId)
foreach ($terminalShellId in $shellIds) { $null = $owned.Add($terminalShellId) }
# Only process identity/topology and numeric resource counters are collected.
$topology = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
do {
    $before = $owned.Count
    foreach ($entry in $topology) {
        if ($owned.Contains([int]$entry.ParentProcessId)) { $null = $owned.Add([int]$entry.ProcessId) }
    }
} while ($owned.Count -ne $before)
$rows = @(foreach ($processId in $owned) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $process) { continue }
    try {
        @{ pid = $process.Id; startTicks = [string]$process.StartTime.ToUniversalTime().Ticks;
           rssKiB = $process.WorkingSet64 / 1024; privateKiB = $process.PrivateMemorySize64 / 1024;
           cpuSeconds = $process.TotalProcessorTime.TotalSeconds;
           group = $(if ($process.Id -eq $AppProcessId) { 'app' } elseif ($shellIds -contains $process.Id) { 'shell' } else { 'descendant' }) }
    } catch { if ($processId -eq $AppProcessId -or $shellIds -contains $processId) { throw } }
})
foreach ($required in @($AppProcessId) + $shellIds) {
    if (-not ($rows | Where-Object { $_.pid -eq $required })) { throw "Expected benchmark process exited: $required" }
}
ConvertTo-Json -InputObject $rows -Compress
