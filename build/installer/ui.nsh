; 按控件的实际像素尺寸进行半色调缩放
Var SPlayerHeaderBitmap

!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.SPlayerGuiInit
!else
  !define MUI_CUSTOMFUNCTION_GUIINIT SPlayerGuiInit
!endif

!macro SPlayerSetBitmap PREFIX CONTROL FILE HANDLE
  System::Store "S"
  Push "${FILE}"
  Push "${CONTROL}"
  Call ${PREFIX}SPlayerSmoothBitmap
  Pop $0
  ${If} $0 != 0
    SendMessage ${CONTROL} ${STM_SETIMAGE} ${IMAGE_BITMAP} $0 $1
    StrCpy ${HANDLE} $0
    System::Call 'gdi32::DeleteObject(p r1)'
  ${EndIf}
  System::Store "L"
!macroend

!macro SPlayerUiFunctions PREFIX
  Function ${PREFIX}SPlayerSmoothBitmap
    System::Store "S"
    Pop $0
    Pop $1
    StrCpy $9 0
    System::Call 'user32::LoadImageW(p 0, w r1, i ${IMAGE_BITMAP}, i 0, i 0, i 0x2010) p.r2'
    ${If} $2 != 0
      System::Alloc 24
      Pop $4
      System::Call 'gdi32::GetObjectW(p r2, i 24, p r4)'
      System::Call '*$4(i, i.r1, i.r3)'
      System::Free $4
      System::Alloc 16
      Pop $4
      System::Call 'user32::GetClientRect(p r0, p r4)'
      System::Call '*$4(i, i, i.r7, i.r8)'
      System::Free $4
      System::Call 'user32::GetDC(p r0) p.r6'
      System::Call 'gdi32::CreateCompatibleDC(p r6) p.r4'
      System::Call 'gdi32::CreateCompatibleDC(p r6) p.r5'
      System::Call 'gdi32::CreateCompatibleBitmap(p r6, i r7, i r8) p.r9'
      System::Call 'gdi32::SelectObject(p r4, p r2)'
      System::Call 'gdi32::SelectObject(p r5, p r9)'
      System::Call 'gdi32::SetStretchBltMode(p r5, i 4)'
      System::Call 'gdi32::SetBrushOrgEx(p r5, i 0, i 0, p 0)'
      System::Call 'gdi32::StretchBlt(p r5, i 0, i 0, i r7, i r8, p r4, i 0, i 0, i r1, i r3, i 0x00CC0020) i.r1'
      System::Call 'gdi32::DeleteDC(p r4)'
      System::Call 'gdi32::DeleteDC(p r5)'
      System::Call 'user32::ReleaseDC(p r0, p r6)'
      System::Call 'gdi32::DeleteObject(p r2)'
      ${If} $1 == 0
        System::Call 'gdi32::DeleteObject(p r9)'
        StrCpy $9 0
      ${EndIf}
    ${EndIf}
    Push $9
    System::Store "L"
  FunctionEnd

  Function ${PREFIX}SPlayerGuiInit
    InitPluginsDir
    File /oname=$PLUGINSDIR\splayer-header.bmp "${MUI_HEADERIMAGE_BITMAP}"
    !insertmacro SPlayerSetBitmap "${PREFIX}" $mui.Header.Image "$PLUGINSDIR\splayer-header.bmp" $SPlayerHeaderBitmap
    System::Store "S"
    GetDlgItem $0 $HWNDPARENT 1
    GetDlgItem $1 $HWNDPARENT 2
    GetDlgItem $2 $HWNDPARENT 3
    System::Alloc 16
    Pop $3
    System::Call 'user32::GetWindowRect(p r0, p r3)'
    System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r3, i 2)'
    System::Call '*$3(i.r4, i, i.r5, i)'
    System::Call 'user32::GetWindowRect(p r1, p r3)'
    System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r3, i 2)'
    System::Call '*$3(i.r6, i, i, i)'
    IntOp $7 $6 - $5
    System::Call 'user32::GetWindowRect(p r2, p r3)'
    System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r3, i 2)'
    System::Call '*$3(i.r0, i.r1, i.r5, i.r6)'
    System::Free $3
    IntOp $5 $5 - $0
    IntOp $6 $6 - $1
    IntOp $4 $4 - $7
    IntOp $4 $4 - $5
    System::Call 'user32::MoveWindow(p r2, i r4, i r1, i r5, i r6, i 1)'
    System::Store "L"
  FunctionEnd

  Function ${PREFIX}SPlayerWelcomeShow
    !insertmacro SPlayerSetBitmap "${PREFIX}" $mui.WelcomePage.Image "$PLUGINSDIR\modern-wizard.bmp" $mui.WelcomePage.Image.Bitmap
  FunctionEnd

  Function ${PREFIX}SPlayerFinishShow
    !insertmacro SPlayerSetBitmap "${PREFIX}" $mui.FinishPage.Image "$PLUGINSDIR\modern-wizard.bmp" $mui.FinishPage.Image.Bitmap
  FunctionEnd

  !if "${PREFIX}" == ""
    Function .onGUIEnd
  !else
    Function un.onGUIEnd
  !endif
    ; 侧图由 MUI 在离页时释放，页眉在向导退出时释放
    System::Call 'gdi32::DeleteObject(p $SPlayerHeaderBitmap)'
  FunctionEnd
!macroend

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    !insertmacro SPlayerUiFunctions "un."
    !insertmacro SPlayerUninstallFunctions
  !else
    !insertmacro SPlayerUiFunctions ""
  !endif
!macroend
