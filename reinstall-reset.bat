@echo off
rem One-off: kill app, reset the leaked myFieldLabel to empty (standard Assignee),
rem reinstall, relaunch. Runs OUTSIDE the MSIX package context via Task Scheduler.
set LOG=C:\LocalCloudSessions\Session_22.05.2026\jira-widget\reinstall-log.txt
echo === reinstall-reset %date% %time% === > "%LOG%"
taskkill /F /IM "Jira Widget.exe" >> "%LOG%" 2>&1
timeout /t 2 /nobreak > nul
node -e "const p='C:/Users/dc_ev/.jira-widget/jira-settings.json';const fs=require('fs');if(fs.existsSync(p)){const j=JSON.parse(fs.readFileSync(p,'utf8'));j.myFieldLabel='';fs.writeFileSync(p,JSON.stringify(j,null,2));console.log('myFieldLabel reset to empty');}" >> "%LOG%" 2>&1
"C:\LocalCloudSessions\Session_22.05.2026\jira-widget\dist\Jira Widget-0.1.0-setup.exe" /S
timeout /t 10 /nobreak > nul
start "" "C:\Users\dc_ev\AppData\Local\Programs\Jira Widget\Jira Widget.exe"
echo done >> "%LOG%"
