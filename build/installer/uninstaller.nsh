!include nsDialogs.nsh
!ifdef BUILD_UNINSTALLER
Var SPlayerRemoveAppData
Var SPlayerRemoveAppDataCheckbox
Var SPlayerUnFinishResult

LangString SPlayerUnWelcomeTitle 2052 "卸载 SPlayer Next"
LangString SPlayerUnWelcomeTitle 1033 "Uninstall SPlayer Next"
LangString SPlayerUnWelcomeText 2052 "此向导将从电脑中卸载 SPlayer Next$\r$\n$\r$\n请先关闭正在运行的播放器$\r$\n点击“下一步”确认卸载"
LangString SPlayerUnWelcomeText 1033 "This wizard will remove SPlayer Next from your computer.$\r$\n$\r$\nPlease close the player before continuing.$\r$\nClick Next to confirm uninstallation."
LangString SPlayerUnConfirmTitle 2052 "确认卸载 SPlayer Next"
LangString SPlayerUnConfirmTitle 1033 "Confirm uninstalling SPlayer Next"
LangString SPlayerUnConfirmSubtitle 2052 "确认后将卸载软件，可选择同时清理应用数据"
LangString SPlayerUnConfirmSubtitle 1033 "Confirm removal and choose whether to clear app data."
LangString SPlayerUnConfirmText 2052 "点击“卸载”移除 SPlayer Next$\r$\n默认保留应用数据，重新安装后可以继续使用"
LangString SPlayerUnConfirmText 1033 "Click Uninstall to remove SPlayer Next.$\r$\nApp data is kept by default for a future reinstall."
LangString SPlayerUnConfirmButton 2052 "卸载(&U)"
LangString SPlayerUnConfirmButton 1033 "Uninstall"
LangString SPlayerUnCaption 2052 "${PRODUCT_NAME} 卸载"
LangString SPlayerUnCaption 1033 "${PRODUCT_NAME} Uninstall"
; 统一原生向导文本，避免后续页面恢复为 NSIS 默认的“解除安装”
UninstallButtonText "$(SPlayerUnConfirmButton)"
UninstallCaption "$(SPlayerUnCaption)"
LangString SPlayerUnRemoveAppData 2052 "同时清理应用数据"
LangString SPlayerUnRemoveAppData 1033 "Also remove app data"
LangString SPlayerUnRemoveAppDataHint 2052 "清理 AppData 中的设置、登录信息及缓存$\r$\n清理后无法恢复"
LangString SPlayerUnRemoveAppDataHint 1033 "Remove settings, sign-ins and cache in AppData.$\r$\nThis cannot be undone."
LangString SPlayerUnFinishTitle 2052 "SPlayer Next 已卸载"
LangString SPlayerUnFinishTitle 1033 "SPlayer Next has been removed"
LangString SPlayerUnFinishText 2052 "卸载完成$\r$\n$\r$\n点击“完成”关闭向导"
LangString SPlayerUnFinishText 1033 "Uninstallation is complete.$\r$\n$\r$\nClick Finish to close this wizard."
LangString SPlayerUnCleanupFailed 2052 "软件已卸载，但部分应用数据未能清理$\r$\n请检查目录权限或文件是否被其他程序占用$\r$\n$\r$\n点击“完成”关闭向导"
LangString SPlayerUnCleanupFailed 1033 "The app was removed, but some app data could not be deleted. Check folder permissions or files in use by another app.$\r$\n$\r$\nClick Finish to close this wizard."

!macro customUnInit
  StrCpy $SPlayerRemoveAppData ${BST_UNCHECKED}
  StrCpy $SPlayerUnFinishResult "$(SPlayerUnFinishText)"
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
  ${AndIf} $SPlayerRemoveAppData == ${BST_CHECKED}
    ClearErrors
    ${GetParameters} $0
    ${GetOptions} $0 "--keep-app-data" $1
    ${If} ${Errors}
      ; 只清理当前用户的应用目录，不处理数据库或应用外部的路径
      SetShellVarContext current
      ClearErrors
      RMDir /r "$APPDATA\${APP_FILENAME}"
      ${If} ${Errors}
        StrCpy $SPlayerUnFinishResult "$(SPlayerUnCleanupFailed)"
        DetailPrint "$(SPlayerUnCleanupFailed)"
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro SPlayerUninstallFunctions
  Function un.SPlayerConfirmCreate
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "$(SPlayerUnConfirmTitle)" "$(SPlayerUnConfirmSubtitle)"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0u 0u 100% 20u "$(SPlayerUnConfirmText)"
    Pop $0
    ${NSD_CreateCheckbox} 0u 26u 100% 12u "$(SPlayerUnRemoveAppData)"
    Pop $SPlayerRemoveAppDataCheckbox
    ${NSD_SetState} $SPlayerRemoveAppDataCheckbox $SPlayerRemoveAppData
    ${NSD_CreateLabel} 12u 42u 96% 24u "$(SPlayerUnRemoveAppDataHint)"
    Pop $0
    GetDlgItem $0 $HWNDPARENT 1
    ${NSD_SetText} $0 "$(SPlayerUnConfirmButton)"
    nsDialogs::Show
  FunctionEnd

  Function un.SPlayerConfirmLeave
    ${NSD_GetState} $SPlayerRemoveAppDataCheckbox $SPlayerRemoveAppData
  FunctionEnd
!macroend
!endif
