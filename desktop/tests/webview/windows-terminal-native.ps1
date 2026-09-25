param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][ValidateSet('activate', 'keys', 'request', 'cancel', 'confirm', 'inspect')][string]$Action,
    [string]$TextBase64 = '',
    [int]$DelayMilliseconds = 10,
    [string]$Enter = 'false'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TerminalNative {
    public delegate bool EnumCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
    [StructLayout(LayoutKind.Sequential)] public struct KeyInput { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public KeyInput keyboard; [FieldOffset(0)] public MouseInput mouse; }
    [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public InputUnion data; }
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, Input[] input, int size);
    public static string Text(IntPtr window) { var text = new StringBuilder(256); GetWindowText(window, text, text.Capacity); return text.ToString(); }
    public static string Class(IntPtr window) { var text = new StringBuilder(256); GetClassName(window, text, text.Capacity); return text.ToString(); }
    public static int Process(IntPtr window) { uint id; GetWindowThreadProcessId(window, out id); return (int)id; }
    public static IntPtr[] Windows(uint process) {
        var windows = new List<IntPtr>();
        EnumWindows((window, state) => { if (Process(window) == process) windows.Add(window); return true; }, IntPtr.Zero);
        return windows.ToArray();
    }
    public static IntPtr Button(IntPtr dialog, string label) {
        IntPtr result = IntPtr.Zero;
        EnumChildWindows(dialog, (window, state) => { if (Class(window) == "Button" && Text(window).Replace("&", "") == label) result = window; return true; }, IntPtr.Zero);
        return result;
    }
    public static string[] Children(IntPtr parent) {
        var children = new List<string>();
        EnumChildWindows(parent, (window, state) => { children.Add(Class(window) + ":" + Process(window)); return true; }, IntPtr.Zero);
        return children.ToArray();
    }
    public static void Activate(IntPtr window, uint process) {
        ShowWindow(window, 9);
        SetForegroundWindow(window);
        for (int attempt = 0; attempt < 50 && Process(GetForegroundWindow()) != process; attempt++) System.Threading.Thread.Sleep(20);
        if (Process(GetForegroundWindow()) != process) throw new InvalidOperationException("Could not foreground the test window");
    }
    public static void Key(ushort character, bool unicode, uint process) {
        if (Process(GetForegroundWindow()) != process) throw new InvalidOperationException("Test window lost foreground; input aborted");
        var inputs = new Input[2];
        for (int i = 0; i < 2; i++) {
            inputs[i].type = 1;
            inputs[i].data.keyboard = new KeyInput { key = unicode ? (ushort)0 : character, scan = unicode ? character : (ushort)0, flags = (unicode ? 4u : 0u) | (i == 1 ? 2u : 0u) };
        }
        if (SendInput(2, inputs, Marshal.SizeOf(typeof(Input))) != 2) throw new InvalidOperationException("SendInput failed: " + Marshal.GetLastWin32Error());
    }
}
'@
$resolvedExecutable = [IO.Path]::GetFullPath($Executable)
$targets = @(Get-Process codeagent -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $resolvedExecutable })
if ($targets.Count -ne 1) { throw 'Expected exactly one application matching the test executable' }
$targetProcess = $targets[0]
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
$main = @([TerminalNative]::Windows($targetProcess.Id) | Where-Object { [TerminalNative]::Class($_) -ne '#32770' -and [TerminalNative]::Text($_) -eq 'CodeAgent' })
if ($main.Count -ne 1) { throw 'Expected one visible CodeAgent test window' }
$mainWindow = $main[0]
if ($Action -eq 'inspect') {
    @{ action = $Action; processId = $targetProcess.Id; mainVisible = [TerminalNative]::IsWindowVisible($mainWindow); children = [TerminalNative]::Children($mainWindow) } | ConvertTo-Json -Compress
    exit
}
if (-not [TerminalNative]::IsWindowVisible($mainWindow)) { throw 'Test main window is hidden' }
if ($Action -eq 'activate' -or $Action -eq 'keys') {
    [TerminalNative]::Activate($mainWindow, $targetProcess.Id)
    if ($Action -eq 'keys') {
        foreach ($character in $text.ToCharArray()) {
            [TerminalNative]::Key([uint16]$character, $true, $targetProcess.Id)
            if ($DelayMilliseconds -gt 0) { Start-Sleep -Milliseconds $DelayMilliseconds }
        }
        if ($Enter -eq 'true') { [TerminalNative]::Key(13, $false, $targetProcess.Id) }
    }
    @{ action = $Action; processId = $targetProcess.Id; characters = $text.Length; foregroundVerified = $true } | ConvertTo-Json -Compress
    exit
}
if ($Action -eq 'request') {
    if (-not [TerminalNative]::PostMessage($mainWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not request native window close' }
}
$dialog = [IntPtr]::Zero
for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $dialogs = @([TerminalNative]::Windows($targetProcess.Id) | Where-Object { [TerminalNative]::IsWindowVisible($_) -and [TerminalNative]::Class($_) -eq '#32770' -and [TerminalNative]::GetWindow($_, 4) -eq $mainWindow })
    if ($dialogs.Count -eq 1) { $dialog = $dialogs[0]; break }
    Start-Sleep -Milliseconds 50
}
if ($dialog -eq [IntPtr]::Zero) { throw 'Native dialog owned by the test window was not found' }
$parentDisabled = -not [TerminalNative]::IsWindowEnabled($mainWindow)
if (-not $parentDisabled) { throw 'Native modal dialog did not disable its parent' }
if ($Action -ne 'request') {
    $button = [TerminalNative]::Button($dialog, $text)
    if ($button -eq [IntPtr]::Zero) { throw 'Native dialog button was not found' }
    if (-not [TerminalNative]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Native dialog button click failed' }
    for ($attempt = 0; $attempt -lt 100 -and [TerminalNative]::IsWindowVisible($dialog); $attempt++) { Start-Sleep -Milliseconds 50 }
    if ([TerminalNative]::IsWindowVisible($dialog)) { throw 'Native dialog remained visible after clicking its button' }
}
@{ action = $Action; processId = $targetProcess.Id; nativeClass = '#32770'; ownedByMainWindow = $true; parentDisabled = $parentDisabled; button = $text } | ConvertTo-Json -Compress
