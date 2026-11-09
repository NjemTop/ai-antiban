; Zastava NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; On uninstall, remove every proxy setting Zastava may have left in the OS (PAC URL,
; PowerShell profile block, legacy HKCU\Environment values, Claude / IDE settings),
; even when the app was killed and never ran its exit cleanup.
;
; NSIS_HOOK_PREUNINSTALL runs before the uninstaller stops a running app, so a live
; Zastava could re-apply its PAC right after a cleanup. That is why the binary is only
; copied here and `--cleanup` runs in NSIS_HOOK_POSTUNINSTALL, after the app is stopped
; and its files are deleted.

!macro NSIS_HOOK_PREUNINSTALL
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\${MAINBINARYNAME}.exe" "$PLUGINSDIR\zastava-cleanup.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} ${FileExists} "$PLUGINSDIR\zastava-cleanup.exe"
    ExecWait '"$PLUGINSDIR\zastava-cleanup.exe" --cleanup'
    Delete "$PLUGINSDIR\zastava-cleanup.exe"
  ${EndIf}
!macroend
