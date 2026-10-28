; Older clients exit through std::process::exit during an in-app update. Their
; runtime children can outlive them and keep installed executables mapped.
; Match full executable paths: never stop another installation or a user's CLI.
Var CodexlyRuntimeCleanupFailed

!macro CodexlyRuntimePaths action
  !insertmacro ${action} "runtime\codex\bin\codex.exe"
  !insertmacro ${action} "runtime\codex\bin\codex-code-mode-host.exe"
  !insertmacro ${action} "runtime\codex\codex-path\rg.exe"
  !insertmacro ${action} "runtime\codex\codex-resources\codex-command-runner.exe"
  !insertmacro ${action} "runtime\codex\codex-resources\codex-windows-sandbox-setup.exe"
  !insertmacro ${action} "runtime\codex\codex-resources\voice\bin\codex-voice-host.exe"
  !insertmacro ${action} "runtime\claude\claude.exe"
  !insertmacro ${action} "claude-host.exe"
!macroend

!macro CodexlyMatchRuntime relativePath
  StrCmp $6 "$INSTDIR\${relativePath}" stop_runtime
!macroend

; Fail before copying/removing files if a protected or still-exiting process
; could not be stopped. Never leave a passive update in a file-retry dialog.
!macro CodexlyCheckRuntimeWritable relativePath
  ${If} $8 = 0
    StrCpy $7 20
    ${DoWhile} $7 > 0
      ${If} ${FileExists} "$INSTDIR\${relativePath}"
        System::Call 'kernel32::CreateFileW(w "$INSTDIR\${relativePath}", i 0x40000000, i 7, p 0, i 3, i 0, p 0) p .r4'
        ${If} $4 P<> -1
          System::Call 'kernel32::CloseHandle(p r4)'
          StrCpy $7 0
        ${Else}
          Sleep 100
          IntOp $7 $7 - 1
          ${If} $7 = 0
            StrCpy $8 1
          ${EndIf}
        ${EndIf}
      ${Else}
        StrCpy $7 0
      ${EndIf}
    ${Loop}
  ${EndIf}
!macroend

!macro CodexlyRuntimeCleanupFunction prefix
Function ${prefix}CodexlyStopInstalledRuntimes
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  System::Call 'kernel32::GetTickCount() i .r9'
  StrCpy $8 0
  System::Alloc 16384
  Pop $0
  ${If} $0 = 0
    StrCpy $8 1
    Goto cleanup_done
  ${EndIf}
  System::Call 'psapi::EnumProcesses(p r0, i 16384, *i .r1) i .r7'
  ${If} $7 = 0
  ${OrIf} $1 >= 16384
    StrCpy $8 1
    Goto cleanup_free
  ${EndIf}
  StrCpy $2 $0
  IntOp $3 $1 / 4
  ${DoWhile} $3 > 0
    System::Call '*$2(i .r4)'
    ; Query a stable handle, with only the rights needed to inspect and stop it.
    System::Call 'kernel32::OpenProcess(i 0x101001, i 0, i r4) p .r5'
    ${If} $5 <> 0
      StrCpy $7 ${NSIS_MAX_STRLEN}
      System::Call 'kernel32::QueryFullProcessImageNameW(p r5, i 0, w .r6, *i r7) i .r7'
      ${If} $7 <> 0
        !insertmacro CodexlyRuntimePaths CodexlyMatchRuntime
        Goto close_process
        stop_runtime:
          DetailPrint "Stopping installed runtime: $6"
          System::Call 'kernel32::GetTickCount() i .r7'
          IntOp $7 $7 - $9
          ${If} $7 >= 10000
            System::Call 'kernel32::CloseHandle(p r5)'
            StrCpy $8 1
            Goto cleanup_free
          ${EndIf}
          System::Call 'kernel32::WaitForSingleObject(p r5, i 0) i .r7'
          ${If} $7 <> 0
            System::Call 'kernel32::TerminateProcess(p r5, i 0)'
            System::Call 'kernel32::WaitForSingleObject(p r5, i 5000) i .r7'
            ${If} $7 <> 0
              StrCpy $8 1
            ${EndIf}
          ${EndIf}
      ${EndIf}
      close_process:
        System::Call 'kernel32::CloseHandle(p r5)'
    ${EndIf}
    IntOp $2 $2 + 4
    IntOp $3 $3 - 1
  ${Loop}
  cleanup_free:
    System::Free $0
    !insertmacro CodexlyRuntimePaths CodexlyCheckRuntimeWritable
  cleanup_done:
  StrCpy $CodexlyRuntimeCleanupFailed $8
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  ${If} $CodexlyRuntimeCleanupFailed <> 0
    SetErrorLevel 1
    Abort "Unable to stop the installed runtime. Close Codexly and retry the update."
  ${EndIf}
FunctionEnd
!macroend

!insertmacro CodexlyRuntimeCleanupFunction ""
!insertmacro CodexlyRuntimeCleanupFunction "un."

; /P /UPDATE is used by the updater. Do this before the maintenance page can
; invoke an older uninstaller, including one that has no runtime cleanup hook.
!define MUI_CUSTOMFUNCTION_GUIINIT CodexlyBeforeInstallerUI
Function CodexlyBeforeInstallerUI
  Push $0
  Push $1
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    ; Let the updater finish its own exit before asking Restart Manager to stop
    ; remaining instances. Opening an image for writing fails while it is mapped.
    StrCpy $1 80
    ${DoWhile} $1 > 0
      ; Tauri includes this file before defining MAINBINARYNAME or UpdateMode.
      ; Keep this name aligned with tauri.conf.json's mainBinaryName.
      IfFileExists "$INSTDIR\codexly.exe" 0 updater_exited
      System::Call 'kernel32::CreateFileW(w "$INSTDIR\codexly.exe", i 0x40000000, i 7, p 0, i 3, i 0, p 0) p .r0'
      ${If} $0 P<> -1
        System::Call 'kernel32::CloseHandle(p r0)'
        Goto updater_exited
      ${EndIf}
      Sleep 250
      IntOp $1 $1 - 1
    ${Loop}
    MessageBox MB_OK|MB_ICONSTOP "Codexly is still running. Close it and retry the update." /SD IDOK
    SetErrorLevel 1
    Abort
    updater_exited:
    Call CodexlyStopInstalledRuntimes
  ${EndIf}
  ClearErrors
  Pop $1
  Pop $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  Call CodexlyStopInstalledRuntimes
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  Call un.CodexlyStopInstalledRuntimes
!macroend
