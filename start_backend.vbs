' 启动后端，完全脱离 cmd/bash 父进程
' 双击此文件即可启动后端（端口 8011）
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\time tracking\backend"
WshShell.Run "cmd /c .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8011 > %USERPROFILE%\backend.log 2>&1", 0, False
WScript.Echo "Backend started on port 8011 (background, no window)"
