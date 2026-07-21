@echo off
rem INSTALL ONLY — kill running app, then silent-reinstall the NEWEST build. Does NOT launch.
rem Launching is done separately via a Task Scheduler action pointing straight at the exe.
rem Always run via Task Scheduler (schtasks), never directly from a Claude shell.
rem NOTE: never hardcode the installer filename — it is versioned (…-<ver>-setup.exe). Hardcoding
rem "0.1.0" made every reinstall silently re-install the ancient build. Pick the newest by date.
set LOG=C:\LocalCloudSessions\Session_22.05.2026\jira-widget\reinstall-log.txt
set DIST=C:\LocalCloudSessions\Session_22.05.2026\jira-widget\dist
echo === reinstall %date% %time% === > "%LOG%"
taskkill /F /IM "Jira Widget.exe" >> "%LOG%" 2>&1
timeout /t 2 /nobreak > nul
set "SETUP="
for /f "delims=" %%f in ('dir /b /a-d /o-d "%DIST%\*-setup.exe"') do if not defined SETUP set "SETUP=%%f"
echo Installing: %SETUP% >> "%LOG%"
"%DIST%\%SETUP%" /S
echo installer exit: %errorlevel% >> "%LOG%"
timeout /t 12 /nobreak > nul
echo installed >> "%LOG%"
