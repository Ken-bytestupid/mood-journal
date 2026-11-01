@echo off
chcp 65001 >nul
title 随记 · 开发服务器
cd /d "%~dp0"

echo ============================================
echo   随记 · 开发服务器
echo --------------------------------------------
echo   启动后请看下面 Vite 打印的 Network 地址：
echo     http://10.x.x.x:5180
echo   手机连同一个 Wi-Fi，浏览器打开这个地址。
echo   关闭本窗口即停止服务。
echo ============================================
echo.

node node_modules\vite\bin\vite.js --host 0.0.0.0 --port 5180

echo.
echo 服务已停止。
pause
