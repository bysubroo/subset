; SubSet.exe - small launcher that starts the app with the bundled Python runtime
Unicode true
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
Name "SubSet"
OutFile "..\dist\SubSet.exe"
Icon "subset.ico"
SilentInstall silent
RequestExecutionLevel user
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SubSet"
VIAddVersionKey "CompanyName" "SubRoo"
VIAddVersionKey "FileDescription" "SubSet - DJ set prep"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "SubRoo"

Section
  IfFileExists "$EXEDIR\runtime\python\pythonw.exe" run
    MessageBox MB_ICONSTOP "SubSet runtime nedostaje. Pokreni SubSet instaler ponovo."
    Quit
  run:
  SetOutPath "$EXEDIR\app"
  Exec '"$EXEDIR\runtime\python\pythonw.exe" -m subset'
SectionEnd
