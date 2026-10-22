; 使用原生向导控件，安装和卸载共用品牌图与字体
ManifestDPIAware true
SetFont /LANG=2052 "Microsoft YaHei UI" 9
SetFont /LANG=1033 "Segoe UI" 9
!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING
!include "${__FILEDIR__}\ui.nsh"
!include "${__FILEDIR__}\uninstaller.nsh"

; 此文件在语言宏之前加载，使用简体中文和英语的 Windows 语言 ID
LangString SPlayerWelcomeTitle 2052 "欢迎安装 SPlayer Next"
LangString SPlayerWelcomeTitle 1033 "Welcome to SPlayer Next"
LangString SPlayerWelcomeText 2052 "听音乐，本该如此$\r$\n$\r$\n一款简洁而精致的多平台桌面音乐播放器。支持多种音频格式与丰富的歌词展现形式，性能经过深度优化，每一处细节都恰到好处。$\r$\n$\r$\n你可以选择安装范围和保存位置$\r$\n点击“下一步”开始"
LangString SPlayerWelcomeText 1033 "Music, just as it should be.$\r$\n$\r$\nA simple, refined desktop music player for multiple platforms. Supports a wide range of audio formats and rich lyric displays, with carefully optimized performance and thoughtful details throughout.$\r$\n$\r$\nChoose who can use the app and where to install it.$\r$\nClick Next to begin."
LangString SPlayerFinishTitle 2052 "SPlayer Next 已安装"
LangString SPlayerFinishTitle 1033 "SPlayer Next is ready"
LangString SPlayerFinishText 2052 "安装完成，可以开始听音乐了$\r$\n$\r$\n点击“完成”关闭向导"
LangString SPlayerFinishText 1033 "Installation is complete. You're ready to enjoy your music.$\r$\n$\r$\nClick Finish to close this wizard."

!macro customWelcomePage
  ; 自动更新沿用 electron-builder 的跳页逻辑
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "$(SPlayerWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(SPlayerWelcomeText)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SPlayerWelcomeShow
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "$(SPlayerFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(SPlayerFinishText)"
  ; 保留 electron-builder 完成页的启动参数和普通用户启动方式
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SPlayerFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(SPlayerUnWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(SPlayerUnWelcomeText)"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.SPlayerWelcomeShow
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.SPlayerConfirmCreate un.SPlayerConfirmLeave
!macroend

!macro customUninstallPage
  !define MUI_FINISHPAGE_TITLE "$(SPlayerUnFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$SPlayerUnFinishResult"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.SPlayerFinishShow
!macroend
