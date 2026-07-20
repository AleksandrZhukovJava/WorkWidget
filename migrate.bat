@echo off
rem Runs OUTSIDE the MSIX package context (via Task Scheduler): merges the virtualized
rem app-data fork into the new unvirtualized data dir, reinstalls, and relaunches.
set LOG=C:\LocalCloudSessions\Session_22.05.2026\jira-widget\migrate-log.txt
echo === migrate start %date% %time% === > "%LOG%"

taskkill /F /IM "Jira Widget.exe" >> "%LOG%" 2>&1
timeout /t 2 /nobreak > nul

set BASE=C:\Users\dc_ev\AppData\Roaming\jira-widget
set FORK=C:\Users\dc_ev\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\jira-widget
set NEWDIR=C:\Users\dc_ev\.jira-widget
set BKP=C:\Users\dc_ev\.jira-widget-base-backup

echo --- backing up REAL base userData (never visible from the sandbox) --- >> "%LOG%"
mkdir "%BKP%" 2>nul
for %%f in ("jira-config.json" "jira-secrets.json" "jira-settings.json" "jira-tracked-keys.json" "Local State") do copy /Y "%BASE%\%%~f" "%BKP%\" >> "%LOG%" 2>&1

echo --- seeding new data dir from the FORK (richest data) --- >> "%LOG%"
mkdir "%NEWDIR%" 2>nul
for %%f in ("jira-config.json" "jira-secrets.json" "jira-settings.json" "jira-tracked-keys.json" "Local State") do copy /Y "%FORK%\%%~f" "%NEWDIR%\" >> "%LOG%" 2>&1

echo --- reinstalling updated build --- >> "%LOG%"
"C:\LocalCloudSessions\Session_22.05.2026\jira-widget\dist\Jira Widget-0.1.0-setup.exe" /S
timeout /t 10 /nobreak > nul

echo --- relaunching (unpackaged context) --- >> "%LOG%"
start "" "C:\Users\dc_ev\AppData\Local\Programs\Jira Widget\Jira Widget.exe"

echo --- BASE dir contents (what your boots saw) --- >> "%LOG%"
dir "%BASE%" >> "%LOG%" 2>&1
echo --- NEW dir contents --- >> "%LOG%"
dir "%NEWDIR%" >> "%LOG%" 2>&1
echo === migrate done %date% %time% === >> "%LOG%"
