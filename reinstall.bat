@echo off
rem INSTALL ONLY — kill running app, then silent-reinstall. Does NOT launch the app.
rem Launching is done separately via a Task Scheduler action pointing straight at the exe
rem (see notes), so the widget is never parented to this console and survives its close.
rem Always run via Task Scheduler (schtasks), never directly from a Claude shell.
set LOG=C:\LocalCloudSessions\Session_22.05.2026\jira-widget\reinstall-log.txt
echo === reinstall %date% %time% === > "%LOG%"
taskkill /F /IM "Jira Widget.exe" >> "%LOG%" 2>&1
timeout /t 2 /nobreak > nul
"C:\LocalCloudSessions\Session_22.05.2026\jira-widget\dist\Jira Widget-0.1.0-setup.exe" /S
timeout /t 10 /nobreak > nul
echo installed >> "%LOG%"
