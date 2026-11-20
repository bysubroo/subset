; SubSet Windows installer (per-user, no admin). Install over an older version to update.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP "SubSet"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\SubSet"

Name "${APP} ${VERSION}"
OutFile "..\dist\SubSet-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\SubSet"
InstallDirRegKey HKCU "Software\SubSet" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
BrandingText "SubSet ${VERSION} - SubRoo"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SubSet"
VIAddVersionKey "CompanyName" "SubRoo"
VIAddVersionKey "FileDescription" "SubSet instaler"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "SubRoo"

!define MUI_ICON "subset.ico"
!define MUI_UNICON "subset.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "SubSet ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Instaler postavlja SubSet i skida sve sto mu treba (Python runtime, PyTorch za tvoju grafiku, AI model za beatgrid).$\r$\n$\r$\nPrvi put skida oko 3 GB. Kada instaliras novu verziju preko stare, skida se samo ono sto je novo, a biblioteka i setovi ostaju sacuvani.$\r$\n$\r$\nZatvori SubSet pre nastavka."
!define MUI_FINISHPAGE_RUN "$INSTDIR\SubSet.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Pokreni SubSet"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SerbianLatin"

Function CloseRunning
  IfFileExists "$LOCALAPPDATA\SubSet\subset.pid" 0 done
    ClearErrors
    FileOpen $0 "$LOCALAPPDATA\SubSet\subset.pid" r
    IfErrors done
    FileRead $0 $1
    FileClose $0
    ${If} $1 != ""
      DetailPrint "Zatvaram SubSet koji je otvoren (PID $1)..."
      nsExec::Exec 'taskkill /F /FI "IMAGENAME eq pythonw.exe" /PID $1'
      Pop $2
      Sleep 800
    ${EndIf}
  done:
FunctionEnd

Section "SubSet" SecMain
  SetDetailsPrint both
  Call CloseRunning

  DetailPrint "Kopiram SubSet ${VERSION}..."
  RMDir /r "$INSTDIR\app"
  SetOutPath "$INSTDIR\app"
  File /r /x "__pycache__" "..\subset"
  SetOutPath "$INSTDIR\app\setup"
  File "..\setup\setup_deps.py"
  File "..\setup\requirements.txt"
  File "..\setup\get-pip.py"
  SetOutPath "$INSTDIR"
  File "..\dist\SubSet.exe"
  File "subset.ico"
  File "..\README.md"

  IfFileExists "$INSTDIR\runtime\python\python.exe" have_python
    DetailPrint "Postavljam Python 3.11 runtime..."
    SetOutPath "$INSTDIR\runtime\python"
    File /r "vendor\python\*.*"
  have_python:

  retry:
  DetailPrint "Proveravam i skidam potrebne biblioteke (ovo moze da potraje)..."
  SetOutPath "$INSTDIR\app"
  nsExec::ExecToLog '"$INSTDIR\runtime\python\python.exe" -u "$INSTDIR\app\setup\setup_deps.py"'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Skidanje biblioteka nije uspelo (kod $0).$\r$\nDetalji: $LOCALAPPDATA\SubSet\install.log$\r$\nProveri internet konekciju i klikni Retry." /SD IDCANCEL IDRETRY retry
    Abort "Instalacija prekinuta."
  ${EndIf}

  DetailPrint "Pravim precice..."
  CreateDirectory "$SMPROGRAMS\SubSet"
  CreateShortCut "$SMPROGRAMS\SubSet\SubSet.lnk" "$INSTDIR\SubSet.exe" "" "$INSTDIR\subset.ico"
  CreateShortCut "$SMPROGRAMS\SubSet\Ukloni SubSet.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\SubSet.lnk" "$INSTDIR\SubSet.exe" "" "$INSTDIR\subset.ico"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\SubSet" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\SubSet" "Version" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "SubSet"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "SubRoo"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\subset.ico"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  DetailPrint "SubSet ${VERSION} je instaliran."
SectionEnd

Section "Uninstall"
  Call un.CloseRunning
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\SubSet.exe"
  Delete "$INSTDIR\subset.ico"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\SubSet.lnk"
  RMDir /r "$SMPROGRAMS\SubSet"
  DeleteRegKey HKCU "${UNINST}"
  DeleteRegKey HKCU "Software\SubSet"
  MessageBox MB_YESNO "Obrisati i biblioteku, analize i setove ($LOCALAPPDATA\SubSet)?$\r$\nTvoji audio fajlovi i exporti u Documents\SubSet se ne diraju." /SD IDNO IDNO keep
    RMDir /r "$LOCALAPPDATA\SubSet"
  keep:
SectionEnd

Function un.CloseRunning
  IfFileExists "$LOCALAPPDATA\SubSet\subset.pid" 0 done
    ClearErrors
    FileOpen $0 "$LOCALAPPDATA\SubSet\subset.pid" r
    IfErrors done
    FileRead $0 $1
    FileClose $0
    ${If} $1 != ""
      nsExec::Exec 'taskkill /F /FI "IMAGENAME eq pythonw.exe" /PID $1'
      Pop $2
      Sleep 800
    ${EndIf}
  done:
FunctionEnd
