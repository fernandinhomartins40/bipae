; Atalho "Bipaê Conector" no menu Iniciar (F2-08): abre o app direto na bandeja, como Conector.
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SMPROGRAMS\Bipaê Conector.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--connector" "$INSTDIR\${MAINBINARYNAME}.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\Bipaê Conector.lnk"
!macroend
