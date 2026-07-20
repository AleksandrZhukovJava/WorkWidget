@echo off
rem Remove the stale dev-Electron login item (registered when the app ran in dev mode
rem with autostart enabled). Runs via Task Scheduler so the REAL registry is touched.
set LOG=C:\LocalCloudSessions\Session_22.05.2026\jira-widget\cleanup-log.txt
echo === cleanup %date% %time% === > "%LOG%"
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "electron.app.Electron" /f >> "%LOG%" 2>&1
echo --- remaining jira/electron Run entries: --- >> "%LOG%"
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" | findstr /I "electron jira" >> "%LOG%" 2>&1
echo done >> "%LOG%"
